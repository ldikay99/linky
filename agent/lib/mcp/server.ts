/**
 * Servidor MCP de Linky (stdio, JSON-RPC 2.0 por líneas), sin dependencias nuevas.
 * Cada herramienta ejecuta el CLI de Linky en un proceso hijo con tiempo máximo; al vencer se mata el
 * árbol completo. Al cerrarse el cliente se terminan todos los hijos: nunca quedan procesos zombis.
 * Las herramientas que usan el navegador compartido se ejecutan de a una (sin choques por el perfil).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchema, TOOLS, type ToolDef } from "./tools.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const MAIN = path.join(ROOT, "agent", "lib", "cli", "main.ts");
const DEFAULT_TIMEOUT = 120_000;
const PROTOCOL = "2025-06-18";

const children = new Set<ChildProcess>();

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-child.pid, "SIGKILL"); // grupo de procesos (detached)
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ya terminó */
    }
  }
}

/** Termina todos los procesos hijos del CLI (lo usa la web al apagarse). */
export function killAllChildren(): void {
  for (const c of children) killTree(c);
}

function shutdown(code = 0): never {
  for (const c of children) killTree(c);
  process.exit(code);
}

/**
 * Ejecuta el CLI y devuelve stdout/stderr. Mata el árbol si excede el tiempo o si se aborta.
 * `env` agrega variables al proceso hijo (p. ej. el directorio de datos de cada persona en la web).
 */
export function runCli(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT,
  opts: { env?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX_CLI, MAIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...opts.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    children.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout!.on("data", (d) => (stdout += d));
    child.stderr!.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const onAbort = () => killTree(child);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      children.delete(child);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

// Cola para herramientas de navegador (un solo uso del perfil a la vez).
let browserQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = browserQueue.then(fn, fn);
  browserQueue = next.catch(() => undefined);
  return next;
}

async function callTool(tool: ToolDef, params: Record<string, unknown>) {
  let args: string[];
  try {
    args = tool.toArgs(params ?? {});
  } catch (e) {
    return { content: [{ type: "text", text: String((e as Error).message) }], isError: true };
  }
  const exec = () => runCli(args, tool.timeoutMs);
  const r = await (tool.browser ? serialized(exec) : exec());
  if (r.timedOut) {
    return { content: [{ type: "text", text: `Tiempo agotado (${Math.round((tool.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)} s); el proceso se cerró por completo. Reintenta o revisa con linky_doctor.` }], isError: true };
  }
  const text = (r.stdout.trim() || r.stderr.trim() || "(sin salida)").slice(0, 200_000);
  return { content: [{ type: "text", text }], isError: r.code !== 0 };
}

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(req: Rpc) {
  const reply = (result: unknown) => req.id !== undefined && send({ jsonrpc: "2.0", id: req.id, result });
  const fail = (code: number, message: string) => req.id !== undefined && send({ jsonrpc: "2.0", id: req.id, error: { code, message } });
  switch (req.method) {
    case "initialize":
      return reply({
        protocolVersion: typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "linky", version: "0.3.0" },
        instructions:
          "Linky registra el día de la persona en Azure DevOps, Ripor y Google Chat. Empieza con linky_doctor o linky_day. " +
          "Toda escritura va con preview → mostrar a la persona → approved=true solo con su 'sí'. Nunca inventar horas, tareas, reuniones ni evidencias. " +
          "Descripciones sin fechas. Reglas completas en AGENTS.md y skills/.",
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchema(t) })) });
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Herramienta desconocida: ${name}`);
      return reply(await callTool(tool, (req.params?.arguments as Record<string, unknown>) ?? {}));
    }
    default:
      return fail(-32601, `Método no soportado: ${req.method}`);
  }
}

export function startServer(): void {
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGHUP", () => shutdown(0));
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req: Rpc;
    try {
      req = JSON.parse(line.replace(/^﻿/, "")) as Rpc; // BOM de PowerShell en la primera línea
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } });
    }
    void handle(req).catch((e) => req.id !== undefined && send({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: String((e as Error).message).split("\n")[0] } }));
  });
  // El cliente cerró la conexión: terminar hijos y salir (sin zombis).
  rl.on("close", () => shutdown(0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
