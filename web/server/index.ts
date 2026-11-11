/**
 * Servidor web de Linky: API + interfaz compilada, en un solo proceso Node/TypeScript.
 * Por defecto escucha solo en loopback; fuera de loopback exige https (proxy TLS) y clave maestra por entorno.
 */
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { killAllChildren } from "../../agent/lib/mcp/server.js";
import { createAi } from "./ai/providers.js";
import { loadConfig } from "./config.js";
import { createFiles } from "./files/files.js";
import { createConnectors } from "./linky/connectors.js";
import { createWorkspaces } from "./linky/workspace.js";
import { registerRoutes } from "./routes.js";
import { createAuth } from "./security/auth.js";
import { KeyRing, resolveMasterKey } from "./security/crypto.js";
import { openStore } from "./store/db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../dist");

async function main() {
  const config = loadConfig();
  const keys = new KeyRing(await resolveMasterKey(config.masterKey));
  const store = openStore(config.dataDir, keys);
  const files = createFiles(config.dataDir, keys, store);
  const workspaces = createWorkspaces(config, keys);
  const ai = createAi(config);
  const connectors = createConnectors();
  const auth = createAuth(config, store);

  const app = Fastify({
    logger: { level: config.dev ? "info" : "warn", redact: ["req.headers.cookie", "req.headers.authorization", "req.headers['x-linky-csrf']"] },
    bodyLimit: 1024 * 1024,
    trustProxy: !config.publicUrl.startsWith("http://"),
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "blob:", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", "blob:"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.publicUrl.startsWith("https://") ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: config.publicUrl.startsWith("https://") ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  // Micrófono solo para esta página (dictado); cámara, geolocalización y demás, apagados.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute", keyGenerator: (req) => req.cookies?.linky_sid?.slice(0, 16) ?? req.ip });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 4, parts: 6 } });
  auth.register(app);
  registerRoutes(app, { config, ai, store, files, workspaces }, connectors);

  if (existsSync(DIST)) {
    await app.register(fastifyStatic, { root: DIST, index: false, wildcard: false, maxAge: "1y", immutable: true, serveDotFiles: false });
    const indexHtml = path.join(DIST, "index.html");
    // Rutas de la app (SPA): siempre index.html sin caché; /api desconocido responde 404 JSON.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.method !== "GET") return reply.code(404).send({ error: "No encontrado." });
      return reply.header("Cache-Control", "no-store").sendFile("index.html", path.dirname(indexHtml), { maxAge: 0, immutable: false });
    });
  } else {
    app.get("/", async (_req, reply) => reply.type("text/plain; charset=utf-8").send("Interfaz sin compilar: ejecuta npm run build en web/ (o npm run dev)."));
  }

  // Dueña del equipo (modo single): se crea la primera vez con el usuario del sistema.
  if (!store.owner()) {
    // En contenedores el usuario del sistema no es la persona: el nombre real llega al conectar Azure.
    const os = userInfo().username;
    store.createUser(process.env.LINKY_WEB_OWNER_NAME?.trim() || (["node", "root", "app"].includes(os) ? "" : os), null, "owner");
  }
  store.purgeExpired();
  setInterval(() => store.purgeExpired(), 3600_000).unref();

  await app.listen({ host: config.host, port: config.port });
  const url = config.dev ? config.publicUrl.replace(`:${config.port}`, ":5173") : config.publicUrl;
  process.stdout.write(`\n  Linky web lista en ${url}\n\n`);
  if (config.openBrowser) openInBrowser(url);
  if (ai.problem) app.log.warn(ai.problem);

  const stop = async () => {
    killAllChildren();
    await app.close().catch(() => undefined);
    store.close();
    process.exit(0);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => void stop());
}

function openInBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(cmd, args as string[], { windowsHide: true }, () => undefined);
}

main().catch((e) => {
  process.stderr.write(`Linky web no pudo arrancar: ${(e as Error).message}\n`);
  killAllChildren();
  process.exit(1);
});
