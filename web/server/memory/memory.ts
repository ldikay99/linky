/**
 * Memoria de Linky para cada persona (todo cifrado en la base):
 * - Recuerdos ("fact"): cómo trabajar para la persona (preferencias, etiquetas, a quién mencionar…), entre chats.
 * - Fragmentos ("chunk"): cada turno de sus conversaciones, para buscar lo hablado antes.
 * Búsqueda semántica con embeddings si el proveedor los tiene; si no, por palabras (BM25), sin enviar nada fuera.
 */
import { randomUUID } from "node:crypto";
import { cosineSimilarity, embed, embedMany, type EmbeddingModel } from "ai";
import { looksSecret } from "../../shared/schemas.js";
import type { MemoryKind, MemoryRow, Store } from "../store/db.js";

const CHUNK_CHARS = 1_500;
const STOP = new Set(
  "a al algo ante como con cual cuando de del desde donde el ella ellos en entre era es esa ese eso esta este esto fue ha hay la las le les lo los mas me mi mis muy no nos o para pero por que se si sin sobre su sus te tu un una uno unos y ya yo the and for".split(" "),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** BM25 sobre los textos dados (suficiente para cientos o miles de recuerdos por persona). */
export function bm25(query: string, docs: string[]): number[] {
  const q = [...new Set(tokens(query))];
  if (!q.length || !docs.length) return docs.map(() => 0);
  const toks = docs.map(tokens);
  const avg = toks.reduce((n, t) => n + t.length, 0) / toks.length || 1;
  const df = new Map(q.map((w) => [w, toks.filter((t) => t.includes(w)).length]));
  const k1 = 1.2;
  const b = 0.75;
  return toks.map((t) => {
    let s = 0;
    for (const w of q) {
      const f = t.filter((x) => x === w).length;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(w)! + 0.5) / (df.get(w)! + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avg)));
    }
    return s;
  });
}

function chunk(text: string): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > CHUNK_CHARS) {
    const cut = Math.max(rest.lastIndexOf("\n", CHUNK_CHARS), rest.lastIndexOf(". ", CHUNK_CHARS), CHUNK_CHARS * 0.6);
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export type MemoryHit = { id: string; kind: MemoryKind; conversationId: string | null; text: string; score: number; createdAt: number };

export function createMemory(store: Store, embedder: EmbeddingModel | null) {
  async function vectors(texts: string[]): Promise<Array<number[] | null>> {
    if (!embedder || !texts.length) return texts.map(() => null);
    try {
      const r = await embedMany({ model: embedder, values: texts, maxRetries: 1, abortSignal: AbortSignal.timeout(30_000) });
      return r.embeddings;
    } catch {
      return texts.map(() => null); // sin embeddings igual se guarda: la búsqueda cae a palabras
    }
  }

  /** Guarda un recuerdo de la persona. No guarda secretos ni duplica lo que ya sabe. */
  async function remember(userId: string, text: string): Promise<{ ok: boolean; id?: string; duplicate?: boolean; reason?: string }> {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 1_000);
    if (clean.length < 3) return { ok: false, reason: "vacío" };
    if (looksSecret(clean)) return { ok: false, reason: "secreto" };
    const existing = store.memories(userId, "fact", 1000);
    const norm = tokens(clean).join(" ");
    const dup = existing.find((m) => tokens(m.text).join(" ") === norm);
    if (dup) return { ok: true, id: dup.id, duplicate: true };
    const [vector] = await vectors([clean]);
    const id = randomUUID();
    store.addMemory({ id, userId, kind: "fact", conversationId: null, text: clean, vector });
    return { ok: true, id };
  }

  /** Indexa un turno (lo que pidió la persona y lo que respondió Linky) para encontrarlo después. */
  async function indexTurn(userId: string, conversationId: string, userText: string, assistantText: string) {
    const body = [userText && `Persona: ${userText}`, assistantText && `Linky: ${assistantText}`].filter(Boolean).join("\n").trim();
    if (body.length < 20 || looksSecret(body)) return;
    const parts = chunk(body).slice(0, 8);
    const vecs = await vectors(parts);
    parts.forEach((text, i) => store.addMemory({ id: randomUUID(), userId, kind: "chunk", conversationId, text, vector: vecs[i] }));
  }

  async function search(userId: string, query: string, opts: { kind?: MemoryKind; k?: number; excludeConversation?: string } = {}): Promise<MemoryHit[]> {
    const rows: MemoryRow[] = store.memories(userId, opts.kind).filter((r) => !opts.excludeConversation || r.conversationId !== opts.excludeConversation);
    if (!rows.length || !query.trim()) return [];
    const lexical = bm25(query, rows.map((r) => r.text));
    let semantic: number[] | null = null;
    if (embedder && rows.some((r) => r.vector)) {
      try {
        const q = (await embed({ model: embedder, value: query, maxRetries: 1, abortSignal: AbortSignal.timeout(15_000) })).embedding;
        semantic = rows.map((r) => (r.vector && r.vector.length === q.length ? cosineSimilarity(q, r.vector) : 0));
      } catch {
        semantic = null;
      }
    }
    const maxLex = Math.max(...lexical, 1e-9);
    return rows
      .map((r, i) => ({
        id: r.id,
        kind: r.kind,
        conversationId: r.conversationId,
        text: r.text,
        createdAt: r.createdAt,
        // Mezcla: significado (si hay) + palabras exactas (IDs de Tasks, nombres, códigos).
        score: semantic ? semantic[i] * 0.7 + (lexical[i] / maxLex) * 0.3 : lexical[i],
      }))
      .filter((h) => h.score > (semantic ? 0.2 : 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.k ?? 6);
  }

  /** Recuerdos para el contexto: los relevantes a lo que se pide más los recientes, dentro del presupuesto. */
  async function contextFacts(userId: string, query: string, budgetChars = 4_000): Promise<string[]> {
    const facts = store.memories(userId, "fact", 400);
    if (!facts.length) return [];
    const ranked = query ? await search(userId, query, { kind: "fact", k: 20 }) : [];
    const ordered = [...ranked.map((h) => h.text), ...facts.map((f) => f.text)];
    const out: string[] = [];
    let used = 0;
    for (const t of new Set(ordered)) {
      if (used + t.length > budgetChars) break;
      out.push(t);
      used += t.length;
    }
    return out;
  }

  return { remember, indexTurn, search, contextFacts, semantic: Boolean(embedder) };
}

export type Memory = ReturnType<typeof createMemory>;
