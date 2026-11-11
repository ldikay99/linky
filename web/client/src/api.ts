/**
 * Cliente de la API: misma origen, cookie de sesión (httpOnly) y encabezado CSRF en cada escritura.
 */
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

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "X-Linky-CSRF": csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Error ${res.status}`, res.status);
  return data;
}

export const api = {
  exchange: (token: string) => request<{ ok: true }>("POST", "/api/auth/exchange", { token }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  session: () => request<SessionInfo>("GET", "/api/session"),
  completeOnboarding: () => request<{ ok: true }>("POST", "/api/onboarding/complete", {}),
  welcome: () => request<{ text: string }>("GET", "/api/welcome"),

  conversations: () => request<ConversationSummary[]>("GET", "/api/conversations"),
  conversation: (id: string) => request<Conversation>("GET", `/api/conversations/${id}`),
  rename: (id: string, title: string) => request<{ ok: true }>("PATCH", `/api/conversations/${id}`, { title }),
  remove: (id: string) => request<{ ok: true }>("DELETE", `/api/conversations/${id}`),

  connectors: (force = false) => request<ConnectorsResponse>("GET", `/api/connectors${force ? "?force=1" : ""}`),
  connectAzure: (organizationUrl: string, pat: string, primary: boolean) => request<{ ok: true; user: string | null }>("POST", "/api/connectors/azure", { organizationUrl, pat, primary }),
  login: (which: "google" | "ripor" | "chat") => request<{ ok: true }>("POST", `/api/connectors/${which}/login`, {}),
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
export function uploadFile(file: File, onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.setRequestHeader("X-Linky-CSRF", csrf);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = xhr.response as Attachment & { error?: string };
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(body?.error ?? `Error ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Sin conexión con el servidor.", 0));
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "dictado.webm");
  const res = await fetch("/api/transcribe", { method: "POST", body: form, credentials: "same-origin", headers: { "X-Linky-CSRF": csrf } });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new ApiError(data.error ?? "No se pudo transcribir.", res.status);
  return data.text ?? "";
}

/** POST que responde por SSE; cada evento llega a onEvent. */
export async function stream(body: unknown, onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Linky-CSRF": csrf, Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? `Error ${res.status}`, res.status);
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
