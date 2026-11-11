/**
 * Caché de adjuntos en memoria (nunca en disco: el servidor responde no-store para no dejar copias sin cifrar).
 * Cada archivo se pide una sola vez; lo que la persona sube se siembra directo desde su equipo.
 */
import { MSG } from "../../shared/messages";
import { ApiError, api } from "./api";

type Entry = { blob: Blob; url: string };
const MAX_BYTES = 200 * 1024 * 1024;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();
let total = 0;

function put(id: string, blob: Blob): Entry {
  const prev = cache.get(id);
  if (prev) return prev;
  const entry = { blob, url: URL.createObjectURL(blob) };
  cache.set(id, entry);
  total += blob.size;
  // Expulsa lo más antiguo si se pasa del tope (Map conserva el orden de inserción).
  for (const [k, v] of cache) {
    if (total <= MAX_BYTES || k === id) break;
    URL.revokeObjectURL(v.url);
    cache.delete(k);
    total -= v.blob.size;
  }
  return entry;
}

export function seedFile(id: string, blob: Blob) {
  put(id, blob);
}

export function cachedUrl(id: string): string | null {
  return cache.get(id)?.url ?? null;
}

export function getFile(id: string): Promise<Entry> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(id);
  if (!p) {
    p = fetch(api.fileUrl(id), { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new ApiError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? MSG.fileNotFound, r.status);
        return put(id, await r.blob());
      })
      .catch((e) => {
        throw e instanceof ApiError ? e : new ApiError(MSG.network, 0);
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

export function clearFileCache() {
  for (const v of cache.values()) URL.revokeObjectURL(v.url);
  cache.clear();
  total = 0;
}
