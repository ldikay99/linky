/**
 * Secretos grandes (sesiones web) troceados en varias entradas del almacén.
 * Windows Credential Manager limita ~2560 bytes (UTF-16) por credencial.
 */
import type { SecretStore } from "./secretStore.js";

const META = "session.meta";
const CHUNK = (i: number) => `session.${i}`;
const CHUNK_CHARS = 1000;

export type ChunkedMeta = { chunks: number; savedAt: string; source: string; extra?: Record<string, string> };

async function readMeta(store: SecretStore, service: string): Promise<ChunkedMeta | null> {
  const raw = await store.get(service, META);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChunkedMeta;
  } catch {
    return null;
  }
}

export async function saveChunkedSecret(
  store: SecretStore,
  service: string,
  payload: string,
  meta: Omit<ChunkedMeta, "chunks">,
): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += CHUNK_CHARS) chunks.push(payload.slice(i, i + CHUNK_CHARS));
  const previous = await readMeta(store, service);
  for (const [i, c] of chunks.entries()) await store.set(service, CHUNK(i), c);
  if (previous && store.delete) {
    for (let i = chunks.length; i < previous.chunks; i++) await store.delete(service, CHUNK(i));
  }
  await store.set(service, META, JSON.stringify({ ...meta, chunks: chunks.length }));
}

export async function loadChunkedSecret(
  store: SecretStore,
  service: string,
): Promise<{ payload: string; meta: ChunkedMeta } | null> {
  const meta = await readMeta(store, service);
  if (!meta) return null;
  let payload = "";
  for (let i = 0; i < meta.chunks; i++) {
    const c = await store.get(service, CHUNK(i));
    if (c == null) return null;
    payload += c;
  }
  return { payload, meta };
}

export async function clearChunkedSecret(store: SecretStore, service: string): Promise<void> {
  if (!store.delete) return;
  const meta = await readMeta(store, service);
  for (let i = 0; i < (meta?.chunks ?? 0); i++) await store.delete(service, CHUNK(i));
  await store.delete(service, META);
}
