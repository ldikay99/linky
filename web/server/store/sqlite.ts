/**
 * Almacenamiento en SQLite (node:sqlite, sin dependencias nativas extra): el predeterminado en el equipo de una persona.
 * Todo el contenido de la persona va cifrado (ver sealed.ts); en claro solo quedan ids, fechas y tipos.
 * El esquema sale de las migraciones de migrations/sqlite (ver migrate.ts).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { KeyRing } from "../security/crypto.js";
import { loadMigrations, pending, type Applied, type MigrationResult } from "./migrate.js";
import { sealer } from "./sealed.js";
import type { MemoryKind, Role, Store, StoredHistory, UserRow } from "./types.js";

type Row = Record<string, unknown>;

export const SQLITE_FILE = "linky-web.db";

/** Aplica las migraciones pendientes. Una base creada antes de las migraciones se reconoce: 0001 no le cambia nada. */
export function migrateSqlite(db: DatabaseSync, dir?: string): MigrationResult {
  const migrations = loadMigrations("sqlite", dir);
  const existing = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get());
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const applied = (db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all() as Row[]).map(
    (r): Applied => ({ version: Number(r.version), name: String(r.name), checksum: String(r.checksum) }),
  );
  const todo = pending(migrations, applied);
  for (const m of todo) {
    // Cada migración con su registro en la misma transacción: o queda completa o no queda.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(m.version, m.name, m.checksum, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`No se pudo aplicar la migración ${m.version} (${m.name}): ${(e as Error).message}`);
    }
  }
  return { applied: todo.map((m) => m.version), version: migrations.length, existing: existing && applied.length === 0 };
}

export function openSqliteStore(dataDir: string, keys: KeyRing): Store & { migration: MigrationResult } {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, SQLITE_FILE));
  // Por conexión y fuera de transacción (no pueden ir en una migración).
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const migration = migrateSqlite(db);
  const sealed = sealer(keys);
  const now = () => Date.now();
  const buf = (v: unknown) => v as Uint8Array;

  const toUser = (r: Row): UserRow => ({
    id: String(r.id),
    name: String(r.name),
    email: r.email ? String(r.email) : null,
    role: r.role as Role,
    onboarded: Number(r.onboarded) === 1,
    createdAt: Number(r.created_at),
  });

  function userById(id: string): UserRow | null {
    const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    return r ? toUser(r) : null;
  }
  function deleteSession(idHash: string) {
    db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
  }

  const store: Store & { migration: MigrationResult } = {
    backend: "sqlite",
    migration,
    close: async () => db.close(),

    async audit(userId, action, detail) {
      db.prepare("INSERT INTO audit (user_id, action, detail, at) VALUES (?, ?, ?, ?)").run(userId, action, detail ?? null, now());
    },

    // ---- usuarios
    userById: async (id) => userById(id),
    async owner() {
      const r = db.prepare("SELECT * FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1").get() as Row | undefined;
      return r ? toUser(r) : null;
    },
    async createUser(name, email, role) {
      const id = randomUUID();
      db.prepare("INSERT INTO users (id, name, email, role, onboarded, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(id, name, email, role, now());
      return userById(id)!;
    },
    async updateUser(id, patch) {
      if (patch.name) db.prepare("UPDATE users SET name = ? WHERE id = ?").run(patch.name, id);
      if (patch.onboarded !== undefined) db.prepare("UPDATE users SET onboarded = ? WHERE id = ?").run(patch.onboarded ? 1 : 0, id);
    },

    // ---- invitaciones y sesiones
    async createInvite(tokenHash, userId, ttlMs) {
      db.prepare("INSERT INTO invites (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, now() + ttlMs);
    },
    async consumeInvite(tokenHash) {
      // Un solo UPDATE condicionado: dos usos simultáneos del mismo enlace no entran los dos.
      const r = db.prepare("UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ? RETURNING user_id").get(now(), tokenHash, now()) as Row | undefined;
      return r ? String(r.user_id) : null;
    },
    async createSession(idHash, userId, csrf, ttlMs) {
      const t = now();
      db.prepare("INSERT INTO sessions (id_hash, user_id, csrf, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)").run(idHash, userId, csrf, t, t + ttlMs, t);
    },
    async session(idHash) {
      const r = db.prepare("SELECT user_id, csrf, expires_at FROM sessions WHERE id_hash = ?").get(idHash) as Row | undefined;
      if (!r) return null;
      if (Number(r.expires_at) < now()) {
        deleteSession(idHash);
        return null;
      }
      db.prepare("UPDATE sessions SET last_seen = ? WHERE id_hash = ?").run(now(), idHash);
      return { userId: String(r.user_id), csrf: String(r.csrf), expiresAt: Number(r.expires_at) };
    },
    deleteSession: async (idHash) => deleteSession(idHash),
    async purgeExpired() {
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
      db.prepare("DELETE FROM invites WHERE expires_at < ? OR used_at IS NOT NULL").run(now());
    },

    // ---- conversaciones
    async listConversations(userId) {
      const rows = db.prepare("SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200").all(userId) as Row[];
      return rows.map((r) => ({ id: String(r.id), title: sealed.title.open(userId, String(r.id), buf(r.title)), updatedAt: Number(r.updated_at) }));
    },
    async createConversation(userId, title) {
      const id = randomUUID();
      const t = now();
      db.prepare("INSERT INTO conversations (id, user_id, title, transcript, history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        userId,
        sealed.title.seal(userId, id, title),
        sealed.transcript.seal(userId, id, []),
        sealed.history.seal(userId, id, { messages: [], previews: {} } satisfies StoredHistory),
        t,
        t,
      );
      return id;
    },
    async conversation(userId, id) {
      const r = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
      if (!r) return null;
      return {
        title: sealed.title.open(userId, id, buf(r.title)),
        transcript: sealed.transcript.open(userId, id, buf(r.transcript)),
        history: sealed.history.open(userId, id, buf(r.history)),
        updatedAt: Number(r.updated_at),
      };
    },
    async saveConversation(userId, id, data) {
      db.prepare("UPDATE conversations SET transcript = ?, history = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
        sealed.transcript.seal(userId, id, data.transcript),
        sealed.history.seal(userId, id, data.history),
        now(),
        id,
        userId,
      );
    },
    async renameConversation(userId, id, title) {
      const r = db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?").run(sealed.title.seal(userId, id, title), id, userId);
      return Number(r.changes) === 1;
    },
    async deleteConversation(userId, id) {
      return Number(db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId).changes) === 1;
    },
    async deleteUserData(userId) {
      db.exec("BEGIN");
      try {
        const conversations = Number(db.prepare("DELETE FROM conversations WHERE user_id = ?").run(userId).changes);
        const files = Number(db.prepare("DELETE FROM files WHERE user_id = ?").run(userId).changes);
        db.exec("COMMIT");
        return { conversations, files };
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },

    // ---- archivos
    async addFile(f) {
      db.prepare("INSERT INTO files (id, user_id, name, media_type, kind, size, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        f.id,
        f.userId,
        sealed.fileName.seal(f.userId, f.id, f.name),
        f.mediaType,
        f.kind,
        f.size,
        f.sha256,
        f.createdAt,
      );
    },
    async file(userId, id) {
      const r = db.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
      if (!r) return null;
      return {
        id: String(r.id),
        userId,
        name: sealed.fileName.open(userId, id, buf(r.name)),
        mediaType: String(r.media_type),
        kind: String(r.kind),
        size: Number(r.size),
        sha256: String(r.sha256),
        createdAt: Number(r.created_at),
      };
    },

    // ---- memoria
    async addMemory(m) {
      db.prepare("INSERT INTO memories (id, user_id, kind, conversation_id, text, vector, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        m.id,
        m.userId,
        m.kind,
        m.conversationId,
        sealed.memoryText.seal(m.userId, m.id, m.text),
        m.vector ? sealed.memoryVector.seal(m.userId, m.id, m.vector) : null,
        now(),
      );
    },
    async memories(userId, kind, limit = 5000) {
      const rows = (
        kind
          ? db.prepare("SELECT * FROM memories WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?").all(userId, kind, limit)
          : db.prepare("SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit)
      ) as Row[];
      return rows.map((r) => ({
        id: String(r.id),
        kind: r.kind as MemoryKind,
        conversationId: r.conversation_id ? String(r.conversation_id) : null,
        text: sealed.memoryText.open(userId, String(r.id), buf(r.text)),
        vector: r.vector ? sealed.memoryVector.open(userId, String(r.id), buf(r.vector)) : null,
        createdAt: Number(r.created_at),
      }));
    },
    async countMemories(userId, kind) {
      return Number((db.prepare("SELECT COUNT(*) AS n FROM memories WHERE user_id = ? AND kind = ?").get(userId, kind) as Row).n);
    },
    async deleteMemory(userId, id) {
      return Number(db.prepare("DELETE FROM memories WHERE id = ? AND user_id = ? AND kind = 'fact'").run(id, userId).changes) === 1;
    },
    async deleteMemories(userId, kind) {
      return Number(db.prepare("DELETE FROM memories WHERE user_id = ? AND kind = ?").run(userId, kind).changes);
    },

    // ---- aprobaciones
    async addApproval(a) {
      db.prepare("INSERT INTO approvals (id, user_id, conversation_id, tool_call_id, tool_name, input, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").run(
        a.id,
        a.userId,
        a.conversationId,
        a.toolCallId,
        a.toolName,
        sealed.approvalInput.seal(a.userId, a.id, a.input),
        now(),
      );
    },
    async approval(userId, id) {
      const r = db.prepare("SELECT * FROM approvals WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
      if (!r) return null;
      return {
        id,
        userId,
        conversationId: String(r.conversation_id),
        toolCallId: String(r.tool_call_id),
        toolName: String(r.tool_name),
        input: sealed.approvalInput.open(userId, id, buf(r.input)),
        status: String(r.status),
      };
    },
    async settleApproval(userId, id, status) {
      const r = db.prepare("UPDATE approvals SET status = ? WHERE id = ? AND user_id = ? AND status = 'pending'").run(status, id, userId);
      return Number(r.changes) === 1;
    },
    async pendingApprovals(userId, conversationId) {
      return (db.prepare("SELECT id FROM approvals WHERE user_id = ? AND conversation_id = ? AND status = 'pending'").all(userId, conversationId) as Row[]).map((r) => String(r.id));
    },
  };
  return store;
}
