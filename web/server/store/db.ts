/**
 * Persistencia de la web en SQLite (node:sqlite, sin dependencias nativas extra).
 * Todo el contenido de la persona va cifrado (ver KeyRing); en claro solo quedan ids, fechas y tipos.
 * La interfaz Store permite cambiar a Postgres/Cloud SQL al escalar sin tocar las rutas.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { KeyRing } from "../security/crypto.js";
import type { ConversationSummary, UiMessage } from "../../shared/protocol.js";

export type Role = "owner" | "admin" | "member";
export type UserRow = { id: string; name: string; email: string | null; role: Role; onboarded: boolean; createdAt: number };
export type SessionRow = { userId: string; csrf: string; expiresAt: number };
export type FileRow = { id: string; userId: string; name: string; mediaType: string; kind: string; size: number; sha256: string; createdAt: number };
export type ApprovalRow = { id: string; userId: string; conversationId: string; toolCallId: string; toolName: string; input: Record<string, unknown>; status: string };

/** Historial del modelo tal como lo guarda Linky: los adjuntos van por id y se hidratan al enviar. */
export type StoredHistory = { messages: unknown[]; previews: Record<string, string>; dayPreviewFile?: string };

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, role TEXT NOT NULL,
  onboarded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title BLOB NOT NULL, transcript BLOB NOT NULL, history BLOB NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS conversations_user ON conversations(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name BLOB NOT NULL, media_type TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, input BLOB NOT NULL,
  status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL);
`;

type Row = Record<string, unknown>;
const buf = (v: unknown) => Buffer.from(v as Uint8Array);

export function openStore(dataDir: string, keys: KeyRing) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, "linky-web.db"));
  db.exec(SCHEMA);
  const now = () => Date.now();

  const toUser = (r: Row): UserRow => ({
    id: String(r.id),
    name: String(r.name),
    email: r.email ? String(r.email) : null,
    role: r.role as Role,
    onboarded: Number(r.onboarded) === 1,
    createdAt: Number(r.created_at),
  });

  const store = {
    close: () => db.close(),

    audit(userId: string | null, action: string, detail?: string) {
      db.prepare("INSERT INTO audit (user_id, action, detail, at) VALUES (?, ?, ?, ?)").run(userId, action, detail ?? null, now());
    },

    // ---- usuarios
    userById(id: string): UserRow | null {
      const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
      return r ? toUser(r) : null;
    },
    owner(): UserRow | null {
      const r = db.prepare("SELECT * FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1").get() as Row | undefined;
      return r ? toUser(r) : null;
    },
    createUser(name: string, email: string | null, role: Role): UserRow {
      const id = randomUUID();
      db.prepare("INSERT INTO users (id, name, email, role, onboarded, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(id, name, email, role, now());
      return store.userById(id)!;
    },
    updateUser(id: string, patch: { name?: string; onboarded?: boolean }) {
      if (patch.name) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(patch.name, id);
      if (patch.onboarded !== undefined) db.prepare("UPDATE users SET onboarded = ? WHERE id = ?").run(patch.onboarded ? 1 : 0, id);
    },

    // ---- invitaciones y sesiones (solo hashes: un volcado de la base no da acceso)
    createInvite(tokenHash: string, userId: string, ttlMs: number) {
      db.prepare("INSERT INTO invites (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, now() + ttlMs);
    },
    consumeInvite(tokenHash: string): string | null {
      const r = db.prepare("SELECT user_id, expires_at, used_at FROM invites WHERE token_hash = ?").get(tokenHash) as Row | undefined;
      if (!r || r.used_at || Number(r.expires_at) < now()) return null;
      db.prepare("UPDATE invites SET used_at = ? WHERE token_hash = ?").run(now(), tokenHash);
      return String(r.user_id);
    },
    createSession(idHash: string, userId: string, csrf: string, ttlMs: number) {
      db.prepare("INSERT INTO sessions (id_hash, user_id, csrf, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)").run(idHash, userId, csrf, now(), now() + ttlMs, now());
    },
    session(idHash: string): SessionRow | null {
      const r = db.prepare("SELECT user_id, csrf, expires_at FROM sessions WHERE id_hash = ?").get(idHash) as Row | undefined;
      if (!r) return null;
      if (Number(r.expires_at) < now()) {
        store.deleteSession(idHash);
        return null;
      }
      db.prepare("UPDATE sessions SET last_seen = ? WHERE id_hash = ?").run(now(), idHash);
      return { userId: String(r.user_id), csrf: String(r.csrf), expiresAt: Number(r.expires_at) };
    },
    deleteSession(idHash: string) {
      db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
    },
    purgeExpired() {
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
      db.prepare("DELETE FROM invites WHERE expires_at < ? OR used_at IS NOT NULL").run(now());
    },

    // ---- conversaciones
    listConversations(userId: string): ConversationSummary[] {
      const rows = db.prepare("SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200").all(userId) as Row[];
      return rows.map((r) => ({
        id: String(r.id),
        title: keys.open(userId, "data", `conv-title:${r.id}`, buf(r.title)).toString("utf8"),
        updatedAt: Number(r.updated_at),
      }));
    },
    createConversation(userId: string, title: string) {
      const id = randomUUID();
      const t = now();
      db.prepare("INSERT INTO conversations (id, user_id, title, transcript, history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        userId,
        keys.seal(userId, "data", `conv-title:${id}`, title),
        keys.sealJson(userId, `conv-transcript:${id}`, []),
        keys.sealJson(userId, `conv-history:${id}`, { messages: [], previews: {} } satisfies StoredHistory),
        t,
        t,
      );
      return id;
    },
    conversation(userId: string, id: string): { title: string; transcript: UiMessage[]; history: StoredHistory; updatedAt: number } | null {
      const r = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
      if (!r) return null;
      return {
        title: keys.open(userId, "data", `conv-title:${id}`, buf(r.title)).toString("utf8"),
        transcript: keys.openJson<UiMessage[]>(userId, `conv-transcript:${id}`, buf(r.transcript)),
        history: keys.openJson<StoredHistory>(userId, `conv-history:${id}`, buf(r.history)),
        updatedAt: Number(r.updated_at),
      };
    },
    saveConversation(userId: string, id: string, data: { transcript: UiMessage[]; history: StoredHistory }) {
      db.prepare("UPDATE conversations SET transcript = ?, history = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
        keys.sealJson(userId, `conv-transcript:${id}`, data.transcript),
        keys.sealJson(userId, `conv-history:${id}`, data.history),
        now(),
        id,
        userId,
      );
    },
    renameConversation(userId: string, id: string, title: string) {
      db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?").run(keys.seal(userId, "data", `conv-title:${id}`, title), id, userId);
    },
    deleteConversation(userId: string, id: string) {
      db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
    },

    // ---- archivos (el contenido va cifrado en disco; aquí solo metadatos)
    addFile(f: FileRow) {
      db.prepare("INSERT INTO files (id, user_id, name, media_type, kind, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        f.id,
        f.userId,
        keys.seal(f.userId, "data", `file-name:${f.id}`, f.name),
        f.mediaType,
        f.kind,
        f.size,
        f.sha256,
        f.createdAt,
      );
    },
    file(userId: string, id: string): FileRow | null {
      const r = db.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
      if (!r) return null;
      return {
        id: String(r.id),
        userId,
        name: keys.open(userId, "data", `file-name:${id}`, buf(r.name)).toString("utf8"),
        mediaType: String(r.media_type),
        kind: String(r.kind),
        size: Number(r.size),
        sha256: String(r.sha256),
        createdAt: Number(r.created_at),
      };
    },

    // ---- aprobaciones (escrituras que esperan el sí de la persona)
    addApproval(a: Omit<ApprovalRow, "status">) {
      db.prepare("INSERT INTO approvals (id, user_id, conversation_id, tool_call_id, tool_name, input, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").run(
        a.id,
        a.userId,
        a.conversationId,
        a.toolCallId,
        a.toolName,
        keys.sealJson(a.userId, `approval:${a.id}`, a.input),
        now(),
      );
    },
    approval(userId: string, id: string): ApprovalRow | null {
      const r = db.prepare("SELECT * FROM approvals WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
      if (!r) return null;
      return {
        id,
        userId,
        conversationId: String(r.conversation_id),
        toolCallId: String(r.tool_call_id),
        toolName: String(r.tool_name),
        input: keys.openJson<Record<string, unknown>>(userId, `approval:${id}`, buf(r.input)),
        status: String(r.status),
      };
    },
    /** Pasa de pending al estado nuevo una sola vez (dos clics no aplican dos veces). */
    settleApproval(userId: string, id: string, status: string): boolean {
      const r = db.prepare("UPDATE approvals SET status = ? WHERE id = ? AND user_id = ? AND status = 'pending'").run(status, id, userId);
      return Number(r.changes) === 1;
    },
    pendingApprovals(userId: string, conversationId: string): string[] {
      return (db.prepare("SELECT id FROM approvals WHERE user_id = ? AND conversation_id = ? AND status = 'pending'").all(userId, conversationId) as Row[]).map((r) => String(r.id));
    },
  };
  return store;
}

export type Store = ReturnType<typeof openStore>;
