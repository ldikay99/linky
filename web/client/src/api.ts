/**
 * Cliente de la API: mismo origen, cookie de sesión (httpOnly) y encabezado CSRF en cada escritura.
 * Si la sesión venció o cambió el token CSRF, se renueva una vez y se reintenta (la persona no ve nada).
 */
import { MSG } from "../../shared/messages";
import type { Attachment, Conversation, ConversationSummary, ConnectorsResponse, FilePreview, MeetingItem, ProfileForm, SessionInfo, StreamEvent } from "../../shared/protocol";

let csrf = "";
export const setCsrf = (v: string) => {
  csrf = v;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type ErrorBody = { error?: string; code?: string };

const isRenewable = (status: number, body: ErrorBody) => status === 401 || (status === 403 && body.code === "csrf");

let renewing: Promise<void> | null = null;
/** Pide la sesión de nuevo (en el equipo de la persona se crea sola) y actualiza el CSRF. */
function renewSession(): Promise<void> {
  renewing ??= fetch("/api/session", { credentials: "same-origin" })
    .then(async (r) => {
      if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as ErrorBody).error ?? MSG.session, r.status);
      setCsrf(((await r.json()) as SessionInfo).csrf);
    })
    .finally(() => {
      renewing = null;
    });
  return renewing;
}

async function send(method: string, url: string, init: RequestInit, retried = false): Promise<Response> {
  const headers = { ...(init.headers as Record<string, string>), ...(method !== "GET" ? { "X-Linky-CSRF": csrf } : {}) };
  let res: Response;
  try {
    res = await fetch(url, { ...init, method, headers, credentials: "same-origin" });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(MSG.network, 0);
  }
  if (!res.ok && !retried) {
    const body = (await res.clone().json().catch(() => ({}))) as ErrorBody;
    if (isRenewable(res.status, body) && url !== "/api/session") {
      await renewSession();
      return send(method, url, init, true);
    }
  }
  return res;
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await send(method, url, {
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) throw new ApiError(data.error ?? MSG.internal, res.status);
  return data;
}

export type AzureOrg = { organizationUrl: string; primary: boolean; status: string };

export const api = {
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  session: () => request<SessionInfo>("GET", "/api/session"),
  completeOnboarding: () => request<{ ok: true }>("POST", "/api/onboarding/complete", {}),
  deleteMyData: () => request<{ ok: true; conversations: number; files: number }>("DELETE", "/api/me/data"),

  conversations: () => request<ConversationSummary[]>("GET", "/api/conversations"),
  conversation: (id: string) => request<Conversation>("GET", `/api/conversations/${id}`),
  rename: (id: string, title: string) => request<{ ok: true }>("PATCH", `/api/conversations/${id}`, { title }),
  remove: (id: string) => request<{ ok: true }>("DELETE", `/api/conversations/${id}`),

  connectors: (force = false) => request<ConnectorsResponse>("GET", `/api/connectors${force ? "?force=1" : ""}`),
  azureOrgs: () => request<{ primary: string | null; orgs: AzureOrg[] }>("GET", "/api/connectors/azure/orgs"),
  connectAzure: (organizationUrl: string, pat: string, primary: boolean) => request<{ ok: true; user: string | null }>("POST", "/api/connectors/azure", { organizationUrl, pat, primary }),
  disconnectAzure: (organizationUrl: string) => request<{ ok: true }>("POST", "/api/connectors/azure/disconnect", { organizationUrl }),
  login: (which: "google" | "ripor" | "chat") => request<{ ok: true }>("POST", `/api/connectors/${which}/login`, {}),
  logoutConnector: (which: "google" | "ripor") => request<{ ok: true }>("POST", `/api/connectors/${which}/logout`, {}),
  devRepos: () => request<{ ok: boolean; data: unknown }>("GET", "/api/connectors/dev/repos"),
  devScan: (root: string) => request<{ ok: true; data: unknown }>("POST", "/api/connectors/dev/scan", { root }),
  devRemove: (repo: string) => request<{ ok: true }>("POST", "/api/connectors/dev/remove", { repo }),

  meetings: (date?: string) => request<{ items: MeetingItem[]; error?: string }>("GET", `/api/onboarding/meetings${date ? `?date=${date}` : ""}`),
  classifyMeeting: (title: string, action: "confirm" | "ignore") => request<{ ok: true }>("POST", "/api/onboarding/meetings", { title, action }),
  saveProfile: (form: ProfileForm) => request<{ ok: true }>("POST", "/api/onboarding/profile", form),

  preview: (id: string) => request<FilePreview>("GET", `/api/files/${id}/preview`),
  fileUrl: (id: string, download = false) => `/api/files/${id}${download ? "?download=1" : ""}`,
};

/** Sube un archivo con progreso (fetch todavía no expone el progreso de subida). */
export function uploadFile(file: File, onProgress: (ratio: number) => void, signal?: AbortSignal, retried = false): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.setRequestHeader("X-Linky-CSRF", csrf);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as Attachment & ErrorBody;
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      if (!retried && isRenewable(xhr.status, body)) {
        return void renewSession()
          .then(() => uploadFile(file, onProgress, signal, true))
          .then(resolve, reject);
      }
      reject(new ApiError(body.error ?? MSG.internal, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(MSG.network, 0));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "dictado.webm");
  const res = await send("POST", "/api/transcribe", { body: form });
  const data = (await res.json().catch(() => ({}))) as { text?: string } & ErrorBody;
  if (!res.ok) throw new ApiError(data.error ?? MSG.sttUnavailable, res.status);
  return data.text ?? "";
}

/** POST que responde por SSE; cada evento llega a onEvent. */
export async function stream(body: unknown, onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await send("POST", "/api/chat", { headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(data.error ?? MSG.internal, res.status);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let i: number;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)) as StreamEvent);
      }
    }
  }
}
