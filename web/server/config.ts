/**
 * Configuración del servidor web, solo por variables de entorno (validadas al arrancar).
 * Proveedor de IA, claves y modelo se fijan aquí: ninguna persona tiene que configurar su IA.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const Provider = z.enum(["none", "openai", "anthropic", "google", "vertex", "mistral", "deepseek"]);
export type ProviderId = z.infer<typeof Provider>;

const Env = z.object({
  NODE_ENV: z.string().default("production"),
  LINKY_WEB_HOST: z.string().default("127.0.0.1"),
  LINKY_WEB_PORT: z.coerce.number().int().min(1).max(65535).default(4780),
  /** Origen público (https) cuando corre detrás de un proxy TLS; obligatorio fuera de loopback. */
  LINKY_WEB_PUBLIC_URL: z.string().url().optional(),
  LINKY_WEB_DATA_DIR: z.string().optional(),
  /** single: la persona del equipo usa su Linky actual. multi: cada usuario tiene su espacio y bóveda propios. */
  LINKY_WEB_TENANCY: z.enum(["single", "multi"]).default("single"),
  /** Clave maestra (32 bytes base64). Sin ella, en single se genera y guarda en el llavero del sistema. */
  LINKY_WEB_MASTER_KEY: z.string().optional(),
  /** Archivo con la clave maestra (secreto de Docker/Kubernetes); tiene prioridad sobre la variable. */
  LINKY_WEB_MASTER_KEY_FILE: z.string().optional(),
  /** keyring: llavero del sistema (equipo de la persona). vault: bóveda cifrada en el directorio de datos (servidores, Docker). */
  LINKY_WEB_SECRET_BACKEND: z.enum(["keyring", "vault"]).default("keyring"),
  /** 1 solo dentro de un contenedor cuyo puerto se publica únicamente en loopback del anfitrión. */
  LINKY_WEB_ALLOW_HTTP: z.enum(["0", "1"]).default("0"),
  /** 0 cuando no hay pantalla para abrir la ventana de inicio de sesión (Google, Ripor). */
  LINKY_WEB_INTERACTIVE_LOGIN: z.enum(["0", "1"]).default("1"),
  LINKY_WEB_OPEN_BROWSER: z.enum(["0", "1"]).default("1"),
  LINKY_WEB_MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).default(25),
  LINKY_WEB_SESSION_HOURS: z.coerce.number().min(1).max(24 * 30).default(24 * 7),
  LINKY_AI_PROVIDER: Provider.default("none"),
  LINKY_AI_MODEL: z.string().optional(),
  LINKY_AI_MAX_STEPS: z.coerce.number().int().min(1).max(40).default(16),
  /** Presupuesto de contexto (caracteres) que se envía al modelo; lo más antiguo se resume. ~3,5 caracteres por token. */
  LINKY_AI_CONTEXT_CHARS: z.coerce.number().int().min(20_000).max(2_000_000).default(140_000),
  /** Embeddings para la memoria: auto (el del proveedor si lo tiene), none (búsqueda por palabras) o uno explícito. */
  LINKY_EMBED_PROVIDER: z.enum(["auto", "none", "openai", "google", "vertex", "mistral"]).default("auto"),
  LINKY_EMBED_MODEL: z.string().optional(),
  LINKY_STT_PROVIDER: z.enum(["browser", "openai"]).default("browser"),
  LINKY_STT_MODEL: z.string().optional(),
});

export type Config = ReturnType<typeof loadConfig>;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(env);
  if (e.LINKY_WEB_MASTER_KEY_FILE) e.LINKY_WEB_MASTER_KEY = readFileSync(e.LINKY_WEB_MASTER_KEY_FILE, "utf8").trim();
  const loopback = LOOPBACK.has(e.LINKY_WEB_HOST);
  const httpOk = e.LINKY_WEB_ALLOW_HTTP === "1" && (!e.LINKY_WEB_PUBLIC_URL || LOOPBACK.has(new URL(e.LINKY_WEB_PUBLIC_URL).hostname));
  if (!loopback && !httpOk && !e.LINKY_WEB_PUBLIC_URL?.startsWith("https://")) {
    throw new Error("Fuera de loopback la web exige LINKY_WEB_PUBLIC_URL con https (detrás de un proxy TLS).");
  }
  if ((e.LINKY_WEB_TENANCY === "multi" || e.LINKY_WEB_SECRET_BACKEND === "vault") && !e.LINKY_WEB_MASTER_KEY) {
    throw new Error("En modo multi la clave maestra va por LINKY_WEB_MASTER_KEY (o el gestor de secretos del despliegue).");
  }
  const localOrigin = `http://${e.LINKY_WEB_HOST === "::1" ? "[::1]" : e.LINKY_WEB_HOST}:${e.LINKY_WEB_PORT}`;
  const origins = new Set<string>([localOrigin, `http://localhost:${e.LINKY_WEB_PORT}`, `http://127.0.0.1:${e.LINKY_WEB_PORT}`]);
  if (e.LINKY_WEB_PUBLIC_URL) origins.add(new URL(e.LINKY_WEB_PUBLIC_URL).origin);
  // Servidor de desarrollo de Vite (proxy hacia este servidor).
  if (e.NODE_ENV === "development") origins.add("http://localhost:5173").add("http://127.0.0.1:5173");
  return {
    dev: e.NODE_ENV === "development",
    host: e.LINKY_WEB_HOST,
    port: e.LINKY_WEB_PORT,
    publicUrl: e.LINKY_WEB_PUBLIC_URL ?? localOrigin,
    origins,
    dataDir: path.resolve(e.LINKY_WEB_DATA_DIR ?? path.join(homedir(), ".linky-web")),
    tenancy: e.LINKY_WEB_TENANCY,
    masterKey: e.LINKY_WEB_MASTER_KEY,
    secretBackend: e.LINKY_WEB_SECRET_BACKEND,
    interactiveLogin: e.LINKY_WEB_INTERACTIVE_LOGIN === "1",
    openBrowser: e.LINKY_WEB_OPEN_BROWSER === "1" && loopback,
    maxUploadBytes: Math.round(e.LINKY_WEB_MAX_UPLOAD_MB * 1024 * 1024),
    sessionMs: e.LINKY_WEB_SESSION_HOURS * 3600_000,
    ai: { provider: e.LINKY_AI_PROVIDER, model: e.LINKY_AI_MODEL, maxSteps: e.LINKY_AI_MAX_STEPS, contextChars: e.LINKY_AI_CONTEXT_CHARS },
    embed: { provider: e.LINKY_EMBED_PROVIDER, model: e.LINKY_EMBED_MODEL },
    stt: { provider: e.LINKY_STT_PROVIDER, model: e.LINKY_STT_MODEL },
  };
}
