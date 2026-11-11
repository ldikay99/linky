/**
 * Acceso a la web.
 * - Entrada con enlace de un solo uso (10 min) que el servidor abre en el navegador al arrancar (modo single)
 *   o que un admin genera como invitación (modo multi). El token viaja en el fragmento (#), no en logs ni Referer.
 * - Sesión en cookie httpOnly + SameSite=Strict + Secure; en la base solo queda el hash del id.
 * - Toda petición que cambia algo exige el encabezado CSRF de la sesión y un Origin permitido.
 * Preparado para SSO (OIDC de Google Workspace) más adelante: solo cambia cómo se llega a createSession.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Store, UserRow } from "../store/db.js";
import { randomToken, safeEqual, sha256 } from "./crypto.js";

export const SESSION_COOKIE = "linky_sid";
const LAUNCH_TTL = 10 * 60_000;
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC = new Set(["/api/auth/exchange", "/api/health"]);

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow;
    csrf?: string;
    sessionHash?: string;
  }
}

export function createAuth(config: Config, store: Store) {
  function launchLink(user: UserRow, ttlMs = LAUNCH_TTL): string {
    const token = randomToken();
    store.createInvite(sha256(token), user.id, ttlMs);
    return `${config.publicUrl}/#t=${token}`;
  }

  function cookieOptions(maxAgeMs: number) {
    return { path: "/", httpOnly: true, sameSite: "strict" as const, secure: true, maxAge: Math.floor(maxAgeMs / 1000) };
  }

  function register(app: FastifyInstance) {
    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      const url = req.url.split("?")[0];
      if (!url.startsWith("/api/")) return;
      if (UNSAFE.has(req.method)) {
        const origin = req.headers.origin;
        if (!origin || !config.origins.has(origin)) return reply.code(403).send({ error: "Origen no permitido." });
      }
      if (PUBLIC.has(url)) return;
      const sid = req.cookies[SESSION_COOKIE];
      const hash = sid ? sha256(sid) : null;
      const session = hash ? store.session(hash) : null;
      const user = session ? store.userById(session.userId) : null;
      if (!session || !user || !hash) return reply.code(401).send({ error: "Sesión no válida." });
      if (UNSAFE.has(req.method)) {
        const sent = req.headers["x-linky-csrf"];
        if (typeof sent !== "string" || !safeEqual(sent, session.csrf)) return reply.code(403).send({ error: "Falta el token CSRF." });
      }
      req.user = user;
      req.csrf = session.csrf;
      req.sessionHash = hash;
    });

    app.post<{ Body: { token?: string } }>(
      "/api/auth/exchange",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const token = typeof req.body?.token === "string" ? req.body.token : "";
        const userId = token.length >= 32 && token.length <= 128 ? store.consumeInvite(sha256(token)) : null;
        if (!userId) return reply.code(401).send({ error: "El enlace venció o ya se usó. Vuelve a abrir Linky." });
        const sid = randomToken();
        store.createSession(sha256(sid), userId, randomToken(24), config.sessionMs);
        store.audit(userId, "session.created");
        reply.setCookie(SESSION_COOKIE, sid, cookieOptions(config.sessionMs));
        return { ok: true };
      },
    );

    app.post("/api/auth/logout", async (req, reply) => {
      if (req.sessionHash) store.deleteSession(req.sessionHash);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });
  }

  return { launchLink, register };
}
