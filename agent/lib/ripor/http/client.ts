/**
 * Cliente HTTP Ripor: las MISMAS peticiones que hace el formulario web
 * (SvelteKit form actions ?/create ?/update ?/delete + GET getReport / __data.json),
 * autenticadas con la sesión del propio usuario. Sin navegador.
 */
import { RIPOR_PUBLIC_URL } from "../types.js";
import { decodeSvelteKitData, parseDevalue } from "./devalue.js";
import { applySetCookie, cookieHeader, type RiporCookieJar } from "./session.js";

export class RiporSessionExpiredError extends Error {
  constructor(detail: string) {
    super(
      `RIPOR_SESSION_EXPIRED: ${detail}. Inicia sesión de nuevo: npm run linky -- ripor login (o ripor login --paste).`,
    );
    this.name = "RiporSessionExpiredError";
  }
}

export type RiporAction = "create" | "update" | "delete";

export type RiporActionResult =
  | { ok: true; type: "success"; status: number; data: unknown }
  | { ok: false; type: "failure" | "error" | "redirect" | "unexpected"; status: number; message: string; data?: unknown };

export type RiporSessionHandle = {
  cookies(): RiporCookieJar;
  /** Persistir cookies refrescadas por el servidor (Set-Cookie). */
  onRefresh(jar: RiporCookieJar): Promise<void>;
};

export type RiporHttpClient = {
  getPageData(): Promise<unknown[]>;
  getReports(dateYmd: string): Promise<unknown>;
  postAction(action: RiporAction, form: Array<[string, string]>): Promise<RiporActionResult>;
};

const TIMEOUT_MS = 30_000;

export function createRiporHttpClient(
  session: RiporSessionHandle,
  fetchImpl: typeof fetch = fetch,
): RiporHttpClient {
  const base = RIPOR_PUBLIC_URL; // https://ripor.co/u/horas

  async function request(url: string, init: { method?: string; body?: string; action?: boolean }): Promise<Response> {
    const headers: Record<string, string> = {
      accept: init.action ? "application/json" : "*/*",
      cookie: cookieHeader(session.cookies()),
      referer: base,
    };
    if (init.action) {
      headers.origin = new URL(base).origin;
      headers["content-type"] = "application/x-www-form-urlencoded";
      headers["x-sveltekit-action"] = "true";
    }
    const res = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (setCookies.length) {
      const jar = { ...session.cookies() };
      if (applySetCookie(jar, setCookies)) await session.onRefresh(jar);
    }
    if (res.status >= 300 && res.status < 400) {
      throw new RiporSessionExpiredError(`redirección ${res.status} a ${res.headers.get("location") ?? "?"}`);
    }
    if (res.status === 401 || res.status === 403) throw new RiporSessionExpiredError(`HTTP ${res.status}`);
    return res;
  }

  async function readJsonOrExpire(res: Response, what: string): Promise<unknown> {
    const text = await res.text();
    // Un 5xx (también la página HTML de un proxy) puede llegar DESPUÉS de ejecutar la acción: es incierto, no
    // "sesión vencida". Solo el HTML de una respuesta no-5xx es la página de login.
    if (res.status >= 500) throw new Error(`${what}: HTTP ${res.status} (resultado incierto)`);
    if (/^\s*</.test(text)) throw new RiporSessionExpiredError(`${what} devolvió HTML (probable login)`);
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${what}: respuesta no JSON`);
    }
  }

  return {
    async getPageData() {
      const res = await request(`${base}/__data.json?x-sveltekit-invalidated=11`, {});
      const text = await res.text();
      if (!res.ok) throw new Error(`__data.json: HTTP ${res.status}`);
      try {
        return decodeSvelteKitData(text);
      } catch (e) {
        if ((e as Error).message === "SVELTEKIT_REDIRECT") throw new RiporSessionExpiredError("__data.json redirige");
        throw e;
      }
    },

    async getReports(dateYmd) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) throw new Error(`Fecha inválida: ${dateYmd}`);
      const res = await request(`${base}/getReport?date=${dateYmd}`, {});
      return readJsonOrExpire(res, "getReport");
    },

    async postAction(action, form) {
      const body = new URLSearchParams(form).toString();
      const res = await request(`${base}?/${action}`, { method: "POST", body, action: true });
      const json = (await readJsonOrExpire(res, `?/${action}`)) as {
        type?: string;
        status?: number;
        data?: unknown;
        location?: string;
        error?: { message?: string };
      };
      const data = typeof json.data === "string" ? safeDevalue(json.data) : json.data;
      if (json.type === "success") return { ok: true, type: "success", status: json.status ?? res.status, data };
      if (json.type === "redirect") {
        if (/login|auth|signin/i.test(json.location ?? "")) {
          throw new RiporSessionExpiredError(`acción redirige a ${json.location}`);
        }
        return { ok: false, type: "redirect", status: json.status ?? 303, message: `redirect ${json.location ?? ""}`, data };
      }
      if (json.type === "failure") {
        return { ok: false, type: "failure", status: json.status ?? 400, message: failureMessage(data), data };
      }
      if (json.type === "error") {
        return { ok: false, type: "error", status: json.status ?? 500, message: json.error?.message ?? "error del servidor" };
      }
      return { ok: false, type: "unexpected", status: res.status, message: "respuesta de acción con formato desconocido" };
    },
  };
}

function safeDevalue(text: string): unknown {
  try {
    return parseDevalue(text);
  } catch {
    return text;
  }
}

function failureMessage(data: unknown): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["message", "error", "msg", "detail"]) {
      if (typeof d[k] === "string" && d[k]) return d[k] as string;
    }
    return JSON.stringify(d).slice(0, 300);
  }
  return typeof data === "string" ? data.slice(0, 300) : "acción rechazada por Ripor";
}
