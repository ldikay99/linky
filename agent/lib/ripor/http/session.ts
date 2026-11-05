/**
 * Sesión Ripor (cookies de autenticación del propio usuario).
 * - Se obtiene con login visual (una vez) o pegando el header Cookie de SU navegador.
 * - Se guarda SOLO en keyring OS (troceada, ver chunkedSecret) 
 *   o en memoria de sesión. Alternativa explícita: env LINKY_RIPOR_COOKIE.
 * - Nunca en el repo, perfil JSON, journal ni logs. Nunca se imprime el valor.
 */
import {
  createKeyringSecretStore,
  createSessionSecretStore,
  type SecretBackend,
  type SecretStore,
} from "../../security/secretStore.js";
import { clearChunkedSecret, loadChunkedSecret, saveChunkedSecret } from "../../security/chunkedSecret.js";

export const RIPOR_ORIGIN = "https://ripor.co";
export const RIPOR_SECRET_SERVICE = "linky-ripor";

export type RiporCookieJar = Record<string, string>;

export type RiporSession = {
  cookies: RiporCookieJar;
  savedAt: string;
  source: "browser" | "paste" | "refresh" | "env";
};

export type RiporSessionStatus = {
  present: boolean;
  source?: RiporSession["source"];
  savedAt?: string;
  authCookies: number;
  hasRefreshToken: boolean;
  accessTokenExpiresAt?: string;
  accessTokenExpired?: boolean;
  email?: string;
};

/** Cookies de auth de Supabase: sb-<ref>-auth-token y sus trozos .0 .1 … */
export function isAuthCookieName(name: string): boolean {
  return /^sb-[a-z0-9]+-auth-token(\.\d+)?$/i.test(name);
}

export function parseCookieHeader(header: string): RiporCookieJar {
  const jar: RiporCookieJar = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

export function cookieHeader(jar: RiporCookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Acepta: header Cookie crudo, línea "cookie: …", o un "Copiar como cURL" (bash o cmd).
 * Devuelve SOLO las cookies de autenticación (descarta analítica).
 */
export function extractAuthCookiesFromPaste(raw: string): RiporCookieJar {
  let text = raw.trim();
  // "Copy as cURL (cmd)" escapa con ^ — quitar los escapes.
  if (/\^"/.test(text) || /\^%/.test(text)) text = text.replace(/\^([\s\S])/g, "$1");
  text = text.replace(/\\\r?\n/g, " ");

  let header: string | undefined;
  const b = /(?:^|\s)(?:-b|--cookie)\s+(["'])([\s\S]*?)\1/.exec(text);
  const h = /(?:-H|--header)\s+(["'])cookie:\s*([\s\S]*?)\1/i.exec(text);
  if (b) header = b[2];
  else if (h) header = h[2];
  else header = text.replace(/^cookie:\s*/i, "");

  const all = parseCookieHeader(header);
  const auth: RiporCookieJar = {};
  for (const [k, v] of Object.entries(all)) if (isAuthCookieName(k)) auth[k] = v;
  if (!Object.keys(auth).length) {
    throw new Error("No se encontraron cookies de sesión Ripor en lo pegado (se esperaba el header Cookie de ripor.co).");
  }
  return auth;
}

/** Aplica Set-Cookie del servidor (refresh de tokens). Devuelve si cambió algo. */
export function applySetCookie(jar: RiporCookieJar, setCookies: string[], now = new Date()): boolean {
  let changed = false;
  for (const sc of setCookies) {
    const [pair, ...attrs] = sc.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    let expired = value === "";
    for (const a of attrs) {
      const [k, v] = a.split("=").map((s) => s?.trim());
      if (/^max-age$/i.test(k ?? "") && Number(v) <= 0) expired = true;
      if (/^expires$/i.test(k ?? "") && v && Date.parse(v) <= now.getTime()) expired = true;
    }
    if (expired) {
      if (name in jar) {
        delete jar[name];
        changed = true;
      }
    } else if (jar[name] !== value) {
      jar[name] = value;
      changed = true;
    }
  }
  return changed;
}

/** Une trozos .0/.1… y decodifica "base64-<json>" para leer metadatos (sin exponer tokens). */
function decodeAuthPayload(jar: RiporCookieJar): Record<string, unknown> | null {
  const bases = new Map<string, Array<{ i: number; v: string }>>();
  for (const [k, v] of Object.entries(jar)) {
    if (!isAuthCookieName(k)) continue;
    const m = /^(.*?)(?:\.(\d+))?$/.exec(k)!;
    const list = bases.get(m[1]) ?? [];
    list.push({ i: m[2] ? Number(m[2]) : 0, v });
    bases.set(m[1], list);
  }
  for (const list of bases.values()) {
    let joined = list.sort((a, b) => a.i - b.i).map((x) => x.v).join("");
    try {
      joined = decodeURIComponent(joined);
    } catch {
      /* ya decodificado */
    }
    try {
      const json = joined.startsWith("base64-")
        ? Buffer.from(joined.slice("base64-".length), "base64url").toString("utf8")
        : joined;
      return JSON.parse(json) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

export function describeRiporSession(session: RiporSession | null, now = new Date()): RiporSessionStatus {
  if (!session) return { present: false, authCookies: 0, hasRefreshToken: false };
  const authCookies = Object.keys(session.cookies).filter(isAuthCookieName).length;
  const payload = decodeAuthPayload(session.cookies);
  const expiresAt = typeof payload?.expires_at === "number" ? payload.expires_at * 1000 : undefined;
  const user = payload?.user as { email?: string } | undefined;
  return {
    present: authCookies > 0,
    source: session.source,
    savedAt: session.savedAt,
    authCookies,
    hasRefreshToken: typeof payload?.refresh_token === "string" && payload.refresh_token.length > 0,
    accessTokenExpiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    accessTokenExpired: expiresAt ? expiresAt <= now.getTime() : undefined,
    email: user?.email,
  };
}

// ---------- almacenamiento ----------

export async function resolveRiporSecretStore(backend?: SecretBackend): Promise<SecretStore> {
  const chosen = backend ?? (process.env.LINKY_SECRET_BACKEND as SecretBackend | undefined);
  if (chosen === "session") return createSessionSecretStore();
  if (chosen === "env") {
    // env es solo lectura (LINKY_RIPOR_COOKIE); los refresh se quedan en memoria.
    return createSessionSecretStore();
  }
  try {
    return await createKeyringSecretStore();
  } catch (e) {
    throw new Error(
      `Keyring no disponible (${(e as Error).message}). Use LINKY_SECRET_BACKEND=session o LINKY_RIPOR_COOKIE. Nunca archivo plaintext.`,
    );
  }
}

export async function saveRiporSession(session: RiporSession, store: SecretStore): Promise<void> {
  await saveChunkedSecret(store, RIPOR_SECRET_SERVICE, JSON.stringify({ cookies: session.cookies }), {
    savedAt: session.savedAt,
    source: session.source,
  });
}

export async function loadRiporSession(store: SecretStore): Promise<RiporSession | null> {
  const fromEnv = process.env.LINKY_RIPOR_COOKIE?.trim();
  if (fromEnv) {
    return { cookies: extractAuthCookiesFromPaste(fromEnv), savedAt: new Date().toISOString(), source: "env" };
  }
  const loaded = await loadChunkedSecret(store, RIPOR_SECRET_SERVICE);
  if (!loaded) return null;
  try {
    const parsed = JSON.parse(loaded.payload) as { cookies: RiporCookieJar };
    return { cookies: parsed.cookies, savedAt: loaded.meta.savedAt, source: loaded.meta.source as RiporSession["source"] };
  } catch {
    return null;
  }
}

export async function clearRiporSession(store: SecretStore): Promise<void> {
  await clearChunkedSecret(store, RIPOR_SECRET_SERVICE);
}
