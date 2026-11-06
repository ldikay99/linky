/** Configuración del chat de reporte (sin secretos): destino y estilo de la persona. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";
import { isConversationUrl } from "./browser.js";

export type ChatConfig = {
  version: 1;
  /** Conversación donde la persona reporta inicio y cierre de jornada. */
  target: { url: string; title?: string; confirmedAt: string };
  /** Ejemplos de mensajes propios (con permiso) para imitar formato y largo. Solo local. */
  styleSamples?: { inicio?: string[]; cierre?: string[] };
  /** Tope de caracteres del mensaje (corto por defecto). */
  maxChars: number;
};

const configPath = (dataDir?: string) => path.join(linkyDataDir(dataDir), "chat.json");

export async function loadChatConfig(dataDir?: string): Promise<ChatConfig | null> {
  try {
    return JSON.parse(await readFile(configPath(dataDir), "utf8")) as ChatConfig;
  } catch {
    return null;
  }
}

export async function saveChatConfig(cfg: ChatConfig, dataDir?: string): Promise<string> {
  if (!isConversationUrl(cfg.target.url)) throw new Error(`No es una conversación de Google Chat: ${cfg.target.url}`);
  await mkdir(linkyDataDir(dataDir), { recursive: true, mode: 0o700 });
  const p = configPath(dataDir);
  await writeFile(p, JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
  return p;
}
