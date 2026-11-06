/**
 * Google Chat: login + elección del chat (onboarding), lectura, borradores y envío con aprobación.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loginAndPickChat } from "../chat/browser.js";
import { loadChatConfig, saveChatConfig } from "../chat/config.js";
import { readConversation, sendMessage } from "../chat/conversation.js";
import { linkyDataDir } from "../security/paths.js";
import type { argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

export type ChatDraft = { text: string; targetUrl: string; createdAt: string; snapshotHash: string };
type SentLog = Array<{ snapshotHash: string; status: "sent" | "unknown"; at: string }>;

function print(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

export function chatDraftHash(text: string, targetUrl: string): string {
  return createHash("sha256").update(JSON.stringify({ text, targetUrl })).digest("hex").slice(0, 32);
}

const sentLogPath = (dataDir?: string) => path.join(linkyDataDir(dataDir), "chat-sent.json");

async function loadSentLog(dataDir?: string): Promise<SentLog> {
  try {
    return JSON.parse(await readFile(sentLogPath(dataDir), "utf8")) as SentLog;
  } catch {
    return [];
  }
}

async function appendSentLog(entry: SentLog[number], dataDir?: string) {
  const log = (await loadSentLog(dataDir)).filter((e) => e.snapshotHash !== entry.snapshotHash);
  log.push(entry);
  await writeFile(sentLogPath(dataDir), JSON.stringify(log, null, 2), { encoding: "utf8", mode: 0o600 });
}

async function requireTarget(dataDir?: string) {
  const cfg = await loadChatConfig(dataDir);
  if (!cfg) throw new Error("No hay chat configurado. Ejecuta: npm run linky -- chat login");
  return cfg;
}

export async function runChatCommand(sub: string | undefined, a: Argv, dataDir?: string): Promise<void> {
  if (sub === "login") {
    const result = await loginAndPickChat({ dataDir, channel: a.arg("--channel") });
    const picked = result.conversation;
    if (!picked) {
      print({
        ok: false,
        message: "No se detectó una conversación abierta al cerrar. Repite y cierra la ventana estando dentro del chat.",
        visited: result.visited,
      });
      process.exitCode = 1;
      return;
    }
    const prev = await loadChatConfig(dataDir);
    const p = await saveChatConfig(
      {
        version: 1,
        target: { url: picked.url, title: picked.title || undefined, confirmedAt: new Date().toISOString() },
        styleSamples: prev?.styleSamples,
        maxChars: prev?.maxChars ?? 600,
      },
      dataDir,
    );
    print({ ok: true, path: p, target: picked, next: "Confirma con la persona que ese es el chat correcto." });
    return;
  }

  if (sub === "status") {
    print({ config: await loadChatConfig(dataDir) });
    return;
  }

  if (sub === "read") {
    const cfg = await requireTarget(dataDir);
    const messages = await readConversation(cfg.target.url, { limit: Number(a.arg("--limit") ?? 15), dataDir });
    print({ target: cfg.target, messages });
    return;
  }

  if (sub === "draft") {
    const cfg = await requireTarget(dataDir);
    const file = a.arg("--file");
    const text = (file ? await readFile(file, "utf8") : a.arg("--text") ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new Error('chat draft --text "<mensaje>" (o --file <ruta>)');
    const blockers: string[] = [];
    if (text.length > cfg.maxChars) blockers.push(`Mensaje largo: ${text.length} > ${cfg.maxChars} caracteres. Resumir.`);
    const draft: ChatDraft = {
      text,
      targetUrl: cfg.target.url,
      createdAt: new Date().toISOString(),
      snapshotHash: chatDraftHash(text, cfg.target.url),
    };
    const out = a.arg("--out") ?? path.join(linkyDataDir(dataDir), "last-chat-draft.json");
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(draft, null, 2), { encoding: "utf8", mode: 0o600 });
    print({
      out,
      snapshotHash: draft.snapshotHash,
      destino: cfg.target.title ?? cfg.target.url,
      mostrarAlUsuario: text,
      caracteres: text.length,
      blockers,
      next: blockers.length
        ? "Corregir y repetir."
        : `Tras aprobación del usuario: npm run linky -- chat send --draft "${out}" --approve --snapshot ${draft.snapshotHash}`,
    });
    if (blockers.length) process.exitCode = 1;
    return;
  }

  if (sub === "send") {
    if (!a.has("--approve")) throw new Error("chat send requiere --approve (aprobación explícita del usuario sobre el borrador).");
    const file = a.arg("--draft") ?? path.join(linkyDataDir(dataDir), "last-chat-draft.json");
    const draft = JSON.parse(await readFile(file, "utf8")) as ChatDraft;
    const cfg = await requireTarget(dataDir);
    if (chatDraftHash(draft.text, draft.targetUrl) !== draft.snapshotHash) throw new Error("El borrador fue modificado: genera uno nuevo.");
    if (a.arg("--snapshot") !== draft.snapshotHash) throw new Error("--snapshot no coincide con el borrador aprobado.");
    if (draft.targetUrl !== cfg.target.url) throw new Error("El chat configurado cambió desde el borrador: genera uno nuevo.");
    const prev = (await loadSentLog(dataDir)).find((e) => e.snapshotHash === draft.snapshotHash);
    if (prev && !a.has("--resend")) {
      throw new Error(
        prev.status === "sent"
          ? "Este mensaje ya se envió. No se duplica."
          : "El envío anterior quedó incierto: revisa con `chat read` antes de reenviar (--resend).",
      );
    }
    const result = await sendMessage(draft.targetUrl, draft.text, { dataDir });
    await appendSentLog(
      { snapshotHash: draft.snapshotHash, status: result.verified ? "sent" : "unknown", at: new Date().toISOString() },
      dataDir,
    );
    print({ ok: result.verified, verified: result.verified, lastMessages: result.lastMessages });
    if (!result.verified) process.exitCode = 1;
    return;
  }

  console.log(`linky chat <login|status|read|draft|send>
  login    navegador visible: inicias sesión en Google, abres el chat de reporte y cierras la ventana
  read     últimos mensajes del chat (formato/estilo, verificación)
  draft    --text "<mensaje>" | --file <ruta>   prepara el mensaje y su hash
  send     --draft <archivo> --approve --snapshot <hash>   publica (headless) y verifica`);
  if (sub) process.exitCode = 1;
}
