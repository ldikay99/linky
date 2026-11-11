import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config.js";
import { createAuth } from "../server/security/auth.js";
import { KeyRing } from "../server/security/crypto.js";
import { openStore } from "../server/store/db.js";

async function app(tenancy: "single" | "multi") {
  const dataDir = await mkdtemp(path.join(tmpdir(), "linky-auth-"));
  const env = { LINKY_WEB_DATA_DIR: dataDir, LINKY_WEB_TENANCY: tenancy, LINKY_WEB_MASTER_KEY: randomBytes(32).toString("base64") };
  const config = loadConfig(env);
  const store = openStore(dataDir, new KeyRing(randomBytes(32)));
  store.createUser("Persona", null, "owner");
  const a = Fastify();
  await a.register(cookie);
  createAuth(config, store).register(a);
  a.get("/api/session", async (req) => ({ user: req.user?.name, csrf: req.csrf }));
  a.post("/api/algo", async () => ({ ok: true }));
  return a;
}

const HOST = { host: "127.0.0.1:4780" };

describe("acceso a la web", () => {
  it("en el equipo de la persona se entra directo, sin enlaces", async () => {
    const a = await app("single");
    const r = await a.inject({ method: "GET", url: "/api/session", headers: HOST });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toBe("Persona");
    const set = String(r.headers["set-cookie"]);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    expect(set).toMatch(/Secure/i);
  });

  it("un dominio ajeno apuntado a 127.0.0.1 no entra (DNS rebinding)", async () => {
    const a = await app("single");
    const r = await a.inject({ method: "GET", url: "/api/session", headers: { host: "evil.example:4780" } });
    expect(r.statusCode).toBe(421);
  });

  it("las escrituras exigen Origin permitido y el token CSRF de la sesión", async () => {
    const a = await app("single");
    const s = await a.inject({ method: "GET", url: "/api/session", headers: HOST });
    const sid = String(s.headers["set-cookie"]).split(";")[0];
    const csrf = s.json().csrf as string;
    const base = { ...HOST, cookie: sid, "content-type": "application/json" };
    expect((await a.inject({ method: "POST", url: "/api/algo", payload: {}, headers: { ...base, origin: "https://evil.example" } })).statusCode).toBe(403);
    expect((await a.inject({ method: "POST", url: "/api/algo", payload: {}, headers: { ...base, origin: "http://127.0.0.1:4780" } })).statusCode).toBe(403);
    expect((await a.inject({ method: "POST", url: "/api/algo", payload: {}, headers: { ...base, origin: "http://127.0.0.1:4780", "x-linky-csrf": csrf } })).statusCode).toBe(200);
  });

  it("en modo multi no hay sesión automática (llega el inicio de sesión con cuenta)", async () => {
    const a = await app("multi");
    expect((await a.inject({ method: "GET", url: "/api/session", headers: HOST })).statusCode).toBe(401);
  });
});
