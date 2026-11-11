/**
 * Acceso a la web.
 * - Modo single (equipo de la persona): se entra directo, sin enlaces ni comandos. La sesión de la dueña se crea
 *   sola. Es seguro porque el servidor solo escucha en loopback y se valida el Host (bloquea DNS rebinding).
 * - Modo multi: queda reservado para el inicio de sesión con cuenta (p. ej. Google Workspace) y URL por persona;
 *   hasta entonces no se crea ninguna sesión automática.
 * - Sesión en cookie httpOnly + SameSite=Strict + Secure; en la base solo queda el hash del id.
 * - Toda petición que cambia algo exige el encabezado CSRF de la sesión y un Origin permitido.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MSG } from "../../shared/messages.js";
import type { Config } from "../config.js";
import type { Store, UserRow } from "../store/db.js";
import { randomToken, safeEqual, sha256 } from "./crypto.js";

export const SESSION_COOKIE = "linky_sid";
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC = new Set(["/api/health"]);

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow;
    csrf?: string;
    sessionHash?: string;
  }
}

export function createAuth(config: Config, store: Store) {
  const allowedHosts = new Set([...config.origins].map((o) => new URL(o).host));

  function cookieOptions(maxAgeMs: number) {
    return { path: "/", httpOnly: true, sameSite: "strict" as const, secure: true, maxAge: Math.floor(maxAgeMs / 1000) };
  }

  /** Sesión automática de la dueña del equipo (solo modo single). */
  function autoSession(reply: FastifyReply): { hash: string; userId: string; csrf: string } | null {
    if (config.tenancy !== "single") return null;
    const owner = store.owner();
    if (!owner) return null;
    const sid = randomToken();
    const csrf = randomToken(24);
    const hash = sha256(sid);
    store.createSession(hash, owner.id, csrf, config.sessionMs);
    reply.setCookie(SESSION_COOKIE, sid, cookieOptions(config.sessionMs));
    return { hash, userId: owner.id, csrf };
  }

  function register(app: FastifyInstance) {
    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      // Solo los nombres de host esperados: una página externa que apunte su dominio a 127.0.0.1 no entra.
      const host = req.headers.host ?? "";
      if (!allowedHosts.has(host) && !(config.dev && host.endsWith(":5173"))) return reply.code(421).send({ error: MSG.host });
      const url = req.url.split("?")[0];
      if (!url.startsWith("/api/")) return;
      if (UNSAFE.has(req.method)) {
        const origin = req.headers.origin;
        if (!origin || !config.origins.has(origin)) return reply.code(403).send({ error: MSG.origin, code: "origin" });
      }
      if (PUBLIC.has(url)) return;
      const sid = req.cookies[SESSION_COOKIE];
      let hash = sid ? sha256(sid) : null;
      let session = hash ? store.session(hash) : null;
      if (!session && req.method === "GET") {
        const created = autoSession(reply);
        if (created) {
          hash = created.hash;
          session = { userId: created.userId, csrf: created.csrf, expiresAt: Date.now() + config.sessionMs };
        }
      }
      const user = session ? store.userById(session.userId) : null;
      if (!session || !user || !hash) {
        return reply.code(401).send({ error: config.tenancy === "multi" ? MSG.multiLogin : MSG.session, code: "session" });
      }
      if (UNSAFE.has(req.method)) {
        const sent = req.headers["x-linky-csrf"];
        if (typeof sent !== "string" || !safeEqual(sent, session.csrf)) return reply.code(403).send({ error: MSG.csrf, code: "csrf" });
      }
      req.user = user;
      req.csrf = session.csrf;
      req.sessionHash = hash;
    });

    app.post("/api/auth/logout", async (req, reply) => {
      if (req.sessionHash) store.deleteSession(req.sessionHash);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });
  }

  return { register };
}
