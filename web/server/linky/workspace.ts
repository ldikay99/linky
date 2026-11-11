/**
 * Espacio de Linky de cada persona. En modo single, la dueña del equipo usa su Linky de siempre
 * (~/.linky y su llavero), así todo lo que ya conectó en el CLI aparece en la web.
 * En modo multi, cada usuario tiene su directorio y su bóveda cifrada (clave derivada, nunca en disco).
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runCli } from "../../../agent/lib/mcp/server.js";
import type { Config } from "../config.js";
import type { KeyRing } from "../security/crypto.js";
import type { UserRow } from "../store/db.js";

export type Workspace = {
  /** Directorio de datos de Linky de la persona. */
  linkyDir: string;
  /** Archivos temporales de la web (planes del día, evidencias descifradas para adjuntar). */
  scratchDir: string;
  env: Record<string, string>;
};

export function createWorkspaces(config: Config, keys: KeyRing) {
  const cache = new Map<string, Workspace>();

  function forUser(user: UserRow): Workspace {
    let ws = cache.get(user.id);
    if (ws) return ws;
    if (config.tenancy === "single" && user.role === "owner") {
      const linkyDir = process.env.LINKY_DATA_DIR ? path.resolve(process.env.LINKY_DATA_DIR) : path.join(homedir(), ".linky");
      // Sin llavero del sistema (Docker, servidores): bóveda cifrada con clave derivada de la maestra.
      const env: Record<string, string> = config.secretBackend === "vault" ? { LINKY_VAULT_KEY: keys.key(user.id, "vault").toString("base64") } : {};
      ws = { linkyDir, scratchDir: path.join(config.dataDir, "scratch", user.id), env };
    } else {
      const base = path.join(config.dataDir, "users", user.id);
      ws = {
        linkyDir: path.join(base, "linky"),
        scratchDir: path.join(base, "scratch"),
        env: { LINKY_DATA_DIR: path.join(base, "linky"), LINKY_VAULT_KEY: keys.key(user.id, "vault").toString("base64") },
      };
    }
    cache.set(user.id, ws);
    return ws;
  }

  return { forUser };
}

/** Cola por persona para las herramientas que usan su perfil de navegador (una a la vez). */
const queues = new Map<string, Promise<unknown>>();
export function serializedFor<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(userId, next.catch(() => undefined));
  return next;
}

export type CliResult = { ok: boolean; text: string; json: unknown | null; timedOut: boolean };

export async function cli(ws: Workspace, args: string[], opts: { timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal } = {}): Promise<CliResult> {
  const r = await runCli(args, opts.timeoutMs ?? 120_000, { env: { ...ws.env, ...opts.env }, signal: opts.signal });
  const text = (r.stdout.trim() || r.stderr.trim() || "(sin salida)").slice(0, 200_000);
  let json: unknown | null = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  if (r.timedOut) return { ok: false, text: "Tiempo agotado; el proceso se cerró por completo.", json: null, timedOut: true };
  return { ok: r.code === 0, text, json, timedOut: false };
}

/** Escribe un JSON temporal en el espacio de la persona (sin secretos) y lo borra al terminar. */
export async function withTempJson<T>(ws: Workspace, value: unknown, fn: (file: string) => Promise<T>, keep = false): Promise<T> {
  await mkdir(ws.scratchDir, { recursive: true, mode: 0o700 });
  const file = path.join(ws.scratchDir, `${randomUUID()}.json`);
  await writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    if (!keep) await rm(file, { force: true });
  }
}
