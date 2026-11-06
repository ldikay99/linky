/**
 * Google Chat: login + elección del chat (onboarding), lectura, borradores y envío con aprobación.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loginAndPickChat } from "../chat/browser.js";
import { loadChatConfig, saveChatConfig } from "../chat/config.js";
import { readConversation, sendMessage } from "../chat/conversation.js";
import { DEFAULT_CHAT_TEMPLATES, deliveredOn, myOpenTasks, renderDayMessage } from "../chat/dayMessages.js";
import { linkyDataDir } from "../security/paths.js";
import { resolveAzureAccess } from "./azureCmd.js";
import { todayLocalYmd, type argvHelpers } from "./riporHttp.js";

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
        templates: prev?.templates,
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

  if (sub === "template") {
    const cfg = await requireTarget(dataDir);
    const templates = { ...(cfg.templates ?? {}) };
    for (const key of ["inicio", "cierre", "item", "vacio"] as const) {
      const v = a.arg(`--${key}`);
      // "\n" escrito literalmente en la terminal = salto de línea.
      if (v !== undefined) templates[key] = v.replace(/\\n/g, "\n");
    }
    // Sin argumentos solo muestra el formato actual; no guarda.
    if (["inicio", "cierre", "item", "vacio"].some((k) => a.arg(`--${k}`) !== undefined)) {
      await saveChatConfig({ ...cfg, templates }, dataDir);
    }
    const sample = { id: 1234, title: "Ejemplo de tarea", state: "En curso", category: "InProgress", project: "Proyecto", url: "https://example.com" };
    print({
      templates: { ...DEFAULT_CHAT_TEMPLATES, ...templates },
      ejemploInicio: renderDayMessage("inicio", { dateYmd: todayLocalYmd(), tareas: [sample] }, templates),
      ejemploCierre: renderDayMessage("cierre", { dateYmd: todayLocalYmd(), entregadas: [sample], en_curso: [] }, templates),
      marcadores: "{fecha} {tareas} {entregadas} {en_curso}; por línea: {id} {titulo} {estado} {url}; \\n = salto de línea",
    });
    return;
  }

  if (sub === "draft") {
    const cfg = await requireTarget(dataDir);
    const file = a.arg("--file");
    let text = (file ? await readFile(file, "utf8") : a.arg("--text") ?? "").replace(/\r\n/g, "\n").trim();
    if (!text && (a.has("--inicio") || a.has("--cierre"))) {
      // Generado desde Azure (organización principal o --org) con la plantilla de la persona.
      const dateYmd = a.arg("--date") ?? todayLocalYmd();
      const access = await resolveAzureAccess({ org: a.arg("--org"), dataDir });
      const open = await myOpenTasks({ organizationUrl: access.organizationUrl, auth: access.auth });
      text = a.has("--inicio")
        ? renderDayMessage("inicio", { dateYmd, tareas: open }, cfg.templates, cfg.maxChars)
        : renderDayMessage(
            "cierre",
            {
              dateYmd,
              entregadas: await deliveredOn({ organizationUrl: access.organizationUrl, auth: access.auth, dateYmd }),
              en_curso: open.filter((t) => t.category === "InProgress"),
            },
            cfg.templates,
            cfg.maxChars,
          );
    }
    if (!text) throw new Error('chat draft --inicio | --cierre [--date] | --text "<mensaje>" | --file <ruta>');
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

  console.log(`linky chat <login|status|read|template|draft|send>
  login    navegador visible: inicias sesión en Google, abres el chat de reporte y cierras la ventana
  read     últimos mensajes del chat (formato/estilo, verificación)
  template --inicio "<texto>" --cierre "<texto>" --item "<línea>"   formato del área de la persona
  draft    --inicio | --cierre [--date] [--org] (desde Azure) o --text/--file   prepara el mensaje y su hash
  send     --draft <archivo> --approve --snapshot <hash>   publica (headless) y verifica`);
  if (sub) process.exitCode = 1;
}
