/**
 * Almacenamiento en PostgreSQL (node-postgres): el del servidor del área. Mismo contrato y mismo cifrado que SQLite.
 * - Todo lo de la persona pasa por `asUser`: una transacción con la persona fijada (`linky.user_id`), así las
 *   políticas de Row Level Security de la base filtran aunque una consulta olvidara su `WHERE user_id`.
 * - Conexión fuera de loopback solo con TLS y verificación completa del certificado (verify-full).
 * - El esquema sale de las migraciones de migrations/postgres, aplicadas al arrancar con un candado de la base
 *   (dos instancias que arrancan a la vez no migran dos veces).
 */
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import pg from "pg";
import type { KeyRing } from "../security/crypto.js";
import { loadMigrations, pending, type Applied, type MigrationResult } from "./migrate.js";
import { sealer } from "./sealed.js";
import { isUuid, type DatabaseConfig, type MemoryKind, type Role, type Store, type StoredHistory, type UserRow } from "./types.js";

type Row = Record<string, unknown>;
type Db = Pick<pg.PoolClient, "query">;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
/** Errores de "todavía no está lista" (arranque del contenedor): se reintenta un rato antes de rendirse. */
const NOT_READY = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "57P03"]);

/**
 * Opciones de conexión a partir de la URL, con las reglas de transporte de docs/DATOS-SENSIBLES.md.
 * Se arman a mano (sin `connectionString`) para que ni `sslmode` en la URL ni variables PG* del entorno las debiliten.
 */
export function connectionOptions(cfg: DatabaseConfig): pg.PoolConfig {
  let u: URL;
  try {
    u = new URL(cfg.url);
  } catch {
    throw new Error("DATABASE_URL no es una URL válida (formato postgres://usuario@servidor:5432/base).");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") throw new Error("DATABASE_URL debe empezar por postgres:// o postgresql://.");
  const socket = u.searchParams.get("host");
  const host = socket || decodeURIComponent(u.hostname).replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!host || !database) throw new Error("DATABASE_URL debe indicar el servidor y la base (postgres://usuario@servidor:5432/base).");
  const local = Boolean(socket?.startsWith("/")) || LOOPBACK.has(host);
  const mode = (u.searchParams.get("sslmode") ?? (local ? "disable" : "verify-full")).toLowerCase();
  if (mode !== "disable" && mode !== "verify-full") {
    throw new Error(`sslmode=${mode} no verifica el certificado y el nombre del servidor: usa verify-full (o disable en loopback).`);
  }
  if (mode === "disable" && !local && !cfg.allowPlaintext) {
    throw new Error("Fuera de loopback la conexión a PostgreSQL exige TLS con verificación del certificado (sslmode=verify-full).");
  }
  if (cfg.schema && !SCHEMA.test(cfg.schema)) throw new Error("Nombre de esquema inválido.");
  return {
    host,
    port: u.port ? Number(u.port) : 5432,
    database,
    user: decodeURIComponent(u.username) || undefined,
    password: cfg.password ?? (u.password ? decodeURIComponent(u.password) : undefined),
    // verify-full: cadena de confianza (rejectUnauthorized) y nombre del servidor (servername, o host si es una IP).
    ssl: mode === "verify-full" ? { rejectUnauthorized: true, ca: cfg.ca, ...(isIP(host) ? { host } : { servername: host }) } : false,
    application_name: "linky-web",
    options: cfg.schema ? `-c search_path=${cfg.schema}` : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForDatabase(pool: pg.Pool, maxMs: number) {
  const until = Date.now() + maxMs;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (!NOT_READY.has(code) || Date.now() > until) throw new Error(`No se pudo conectar a PostgreSQL: ${(e as Error).message}`);
      await sleep(1_000);
    }
  }
}

/** Aplica las migraciones pendientes, cada una en su transacción, con un candado por esquema. */
export async function migratePostgres(pool: pg.Pool, schema?: string, dir?: string): Promise<MigrationResult> {
  const migrations = loadMigrations("postgres", dir);
  const c = await pool.connect();
  try {
    // El candado va primero (y por nombre de esquema): crear el esquema tampoco es seguro con dos instancias a la vez.
    const lock = `linky-web/migraciones/${schema ?? "predeterminado"}`;
    await c.query("SELECT pg_advisory_lock(hashtext($1))", [lock]);
    try {
      if (schema) await c.query(`CREATE SCHEMA IF NOT EXISTS ${pg.escapeIdentifier(schema)}`);
      await c.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const applied = (await c.query("SELECT version, name, checksum FROM schema_migrations ORDER BY version")).rows.map(
        (r: Row): Applied => ({ version: Number(r.version), name: String(r.name), checksum: String(r.checksum) }),
      );
      const todo = pending(migrations, applied);
      for (const m of todo) {
        await c.query("BEGIN");
        try {
          await c.query(m.sql);
          await c.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [m.version, m.name, m.checksum]);
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw new Error(`No se pudo aplicar la migración ${m.version} (${m.name}): ${(e as Error).message}`);
        }
      }
      return { applied: todo.map((m) => m.version), version: migrations.length, existing: false };
    } finally {
      await c.query("SELECT pg_advisory_unlock(hashtext($1))", [lock]);
    }
  } finally {
    c.release();
  }
}

/** Avisos de configuración que no impiden arrancar pero debilitan el aislamiento. */
async function roleWarnings(pool: pg.Pool): Promise<string[]> {
  const r = (await pool.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0] as Row | undefined;
  if (r && (r.rolsuper || r.rolbypassrls)) {
    return ["La web se conecta a PostgreSQL con un rol superusuario o con BYPASSRLS: el aislamiento por persona (RLS) no aplica. Usa el rol de la aplicación (ver web/README.md)."];
  }
  return [];
}

export async function openPostgresStore(cfg: DatabaseConfig, keys: KeyRing, opts: { waitMs?: number } = {}): Promise<Store & { migration: MigrationResult; warnings: string[] }> {
  const pool = new pg.Pool(connectionOptions(cfg));
  // Un cliente inactivo que pierde la conexión (reinicio de la base) no debe tumbar el proceso: la próxima consulta falla y se informa.
  pool.on("error", () => undefined);
  let migration: MigrationResult;
  let warnings: string[];
  try {
    await waitForDatabase(pool, opts.waitMs ?? 30_000);
    migration = await migratePostgres(pool, cfg.schema);
    warnings = await roleWarnings(pool);
  } catch (e) {
    await pool.end().catch(() => undefined);
    throw e;
  }
  const sealed = sealer(keys);
  const at = (ms = Date.now()) => new Date(ms);
  const ms = (v: unknown) => (v as Date).getTime();
  const buf = (v: unknown) => v as Uint8Array;

  /** Operación sobre los datos de una persona: transacción con la persona fijada para Row Level Security. */
  async function asUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
    if (!isUuid(userId)) throw new Error("Id de persona inválido.");
    const c = await pool.connect();
    let broken = false;
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('linky.user_id', $1, true)", [userId]);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {
        broken = true;
      });
      throw e;
    } finally {
      c.release(broken);
    }
  }

  const toUser = (r: Row): UserRow => ({
    id: String(r.id),
    name: String(r.name),
    email: r.email ? String(r.email) : null,
    role: r.role as Role,
    onboarded: Boolean(r.onboarded),
    createdAt: ms(r.created_at),
  });

  async function deleteSession(idHash: string) {
    await pool.query("DELETE FROM sessions WHERE id_hash = $1", [idHash]);
  }

  return {
    backend: "postgres",
    migration,
    warnings,
    close: () => pool.end(),

    async audit(userId, action, detail) {
      await pool.query("INSERT INTO audit (user_id, action, detail, at) VALUES ($1, $2, $3, $4)", [userId && isUuid(userId) ? userId : null, action, detail ?? null, at()]);
    },

    // ---- usuarios
    async userById(id) {
      if (!isUuid(id)) return null;
      const r = (await pool.query("SELECT * FROM users WHERE id = $1", [id])).rows[0] as Row | undefined;
      return r ? toUser(r) : null;
    },
    async owner() {
      const r = (await pool.query("SELECT * FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1")).rows[0] as Row | undefined;
      return r ? toUser(r) : null;
    },
    async createUser(name, email, role) {
      const r = (await pool.query("INSERT INTO users (id, name, email, role, onboarded, created_at) VALUES ($1, $2, $3, $4, false, $5) RETURNING *", [randomUUID(), name, email, role, at()]))
        .rows[0] as Row;
      return toUser(r);
    },
    async updateUser(id, patch) {
      if (!isUuid(id)) return;
      if (patch.name) await pool.query("UPDATE users SET name = $1 WHERE id = $2", [patch.name, id]);
      if (patch.onboarded !== undefined) await pool.query("UPDATE users SET onboarded = $1 WHERE id = $2", [patch.onboarded, id]);
    },

    // ---- invitaciones y sesiones
    async createInvite(tokenHash, userId, ttlMs) {
      const t = Date.now();
      await pool.query("INSERT INTO invites (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [tokenHash, userId, at(t), at(t + ttlMs)]);
    },
    async consumeInvite(tokenHash) {
      // Un solo UPDATE condicionado: dos usos simultáneos del mismo enlace no entran los dos.
      const t = at();
      const r = (await pool.query("UPDATE invites SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at >= $2 RETURNING user_id", [tokenHash, t])).rows[0] as Row | undefined;
      return r ? String(r.user_id) : null;
    },
    async createSession(idHash, userId, csrf, ttlMs) {
      const t = Date.now();
      await pool.query("INSERT INTO sessions (id_hash, user_id, csrf, created_at, expires_at, last_seen) VALUES ($1, $2, $3, $4, $5, $4)", [idHash, userId, csrf, at(t), at(t + ttlMs)]);
    },
    async session(idHash) {
      const t = at();
      const r = (await pool.query("UPDATE sessions SET last_seen = $2 WHERE id_hash = $1 AND expires_at >= $2 RETURNING user_id, csrf, expires_at", [idHash, t])).rows[0] as Row | undefined;
      if (r) return { userId: String(r.user_id), csrf: String(r.csrf), expiresAt: ms(r.expires_at) };
      await pool.query("DELETE FROM sessions WHERE id_hash = $1 AND expires_at < $2", [idHash, t]);
      return null;
    },
    deleteSession,
    async purgeExpired() {
      const t = at();
      await pool.query("DELETE FROM sessions WHERE expires_at < $1", [t]);
      await pool.query("DELETE FROM invites WHERE expires_at < $1 OR used_at IS NOT NULL", [t]);
    },

    // ---- conversaciones
    listConversations: (userId) =>
      asUser(userId, async (db) => {
        const rows = (await db.query("SELECT id, title, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200", [userId])).rows as Row[];
        return rows.map((r) => ({ id: String(r.id), title: sealed.title.open(userId, String(r.id), buf(r.title)), updatedAt: ms(r.updated_at) }));
      }),
    createConversation: (userId, title) =>
      asUser(userId, async (db) => {
        const id = randomUUID();
        const t = at();
        await db.query("INSERT INTO conversations (id, user_id, title, transcript, history, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)", [
          id,
          userId,
          sealed.title.seal(userId, id, title),
          sealed.transcript.seal(userId, id, []),
          sealed.history.seal(userId, id, { messages: [], previews: {} } satisfies StoredHistory),
          t,
        ]);
        return id;
      }),
    async conversation(userId, id) {
      if (!isUuid(id)) return null;
      return asUser(userId, async (db) => {
        const r = (await db.query("SELECT title, transcript, history, updated_at FROM conversations WHERE id = $1 AND user_id = $2", [id, userId])).rows[0] as Row | undefined;
        if (!r) return null;
        return {
          title: sealed.title.open(userId, id, buf(r.title)),
          transcript: sealed.transcript.open(userId, id, buf(r.transcript)),
          history: sealed.history.open(userId, id, buf(r.history)),
          updatedAt: ms(r.updated_at),
        };
      });
    },
    async saveConversation(userId, id, data) {
      if (!isUuid(id)) return;
      await asUser(userId, (db) =>
        db.query("UPDATE conversations SET transcript = $1, history = $2, updated_at = $3 WHERE id = $4 AND user_id = $5", [
          sealed.transcript.seal(userId, id, data.transcript),
          sealed.history.seal(userId, id, data.history),
          at(),
          id,
          userId,
        ]),
      );
    },
    async renameConversation(userId, id, title) {
      if (!isUuid(id)) return false;
      const r = await asUser(userId, (db) => db.query("UPDATE conversations SET title = $1 WHERE id = $2 AND user_id = $3", [sealed.title.seal(userId, id, title), id, userId]));
      return r.rowCount === 1;
    },
    async deleteConversation(userId, id) {
      if (!isUuid(id)) return false;
      const r = await asUser(userId, (db) => db.query("DELETE FROM conversations WHERE id = $1 AND user_id = $2", [id, userId]));
      return r.rowCount === 1;
    },
    deleteUserData: (userId) =>
      asUser(userId, async (db) => {
        const conversations = (await db.query("DELETE FROM conversations WHERE user_id = $1", [userId])).rowCount ?? 0;
        const files = (await db.query("DELETE FROM files WHERE user_id = $1", [userId])).rowCount ?? 0;
        return { conversations, files };
      }),

    // ---- archivos
    async addFile(f) {
      await asUser(f.userId, (db) =>
        db.query("INSERT INTO files (id, user_id, name, media_type, kind, size, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
          f.id,
          f.userId,
          sealed.fileName.seal(f.userId, f.id, f.name),
          f.mediaType,
          f.kind,
          f.size,
          f.sha256,
          at(f.createdAt),
        ]),
      );
    },
    async file(userId, id) {
      if (!isUuid(id)) return null;
      return asUser(userId, async (db) => {
        const r = (await db.query("SELECT * FROM files WHERE id = $1 AND user_id = $2", [id, userId])).rows[0] as Row | undefined;
        if (!r) return null;
        return {
          id,
          userId,
          name: sealed.fileName.open(userId, id, buf(r.name)),
          mediaType: String(r.media_type),
          kind: String(r.kind),
          size: Number(r.size),
          sha256: String(r.sha256),
          createdAt: ms(r.created_at),
        };
      });
    },

    // ---- memoria
    async addMemory(m) {
      await asUser(m.userId, (db) =>
        db.query("INSERT INTO memories (id, user_id, kind, conversation_id, text, vector, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
          m.id,
          m.userId,
          m.kind,
          m.conversationId,
          sealed.memoryText.seal(m.userId, m.id, m.text),
          m.vector ? sealed.memoryVector.seal(m.userId, m.id, m.vector) : null,
          at(),
        ]),
      );
    },
    memories: (userId, kind, limit = 5000) =>
      asUser(userId, async (db) => {
        const rows = (
          kind
            ? await db.query("SELECT * FROM memories WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT $3", [userId, kind, limit])
            : await db.query("SELECT * FROM memories WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, limit])
        ).rows as Row[];
        return rows.map((r) => ({
          id: String(r.id),
          kind: r.kind as MemoryKind,
          conversationId: r.conversation_id ? String(r.conversation_id) : null,
          text: sealed.memoryText.open(userId, String(r.id), buf(r.text)),
          vector: r.vector ? sealed.memoryVector.open(userId, String(r.id), buf(r.vector)) : null,
          createdAt: ms(r.created_at),
        }));
      }),
    countMemories: (userId, kind) =>
      asUser(userId, async (db) => Number((await db.query("SELECT count(*) AS n FROM memories WHERE user_id = $1 AND kind = $2", [userId, kind])).rows[0].n)),
    async deleteMemory(userId, id) {
      if (!isUuid(id)) return false;
      const r = await asUser(userId, (db) => db.query("DELETE FROM memories WHERE id = $1 AND user_id = $2 AND kind = 'fact'", [id, userId]));
      return r.rowCount === 1;
    },
    deleteMemories: (userId, kind) => asUser(userId, async (db) => (await db.query("DELETE FROM memories WHERE user_id = $1 AND kind = $2", [userId, kind])).rowCount ?? 0),

    // ---- aprobaciones
    async addApproval(a) {
      await asUser(a.userId, (db) =>
        db.query("INSERT INTO approvals (id, user_id, conversation_id, tool_call_id, tool_name, input, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)", [
          a.id,
          a.userId,
          a.conversationId,
          a.toolCallId,
          a.toolName,
          sealed.approvalInput.seal(a.userId, a.id, a.input),
          at(),
        ]),
      );
    },
    async approval(userId, id) {
      if (!isUuid(id)) return null;
      return asUser(userId, async (db) => {
        const r = (await db.query("SELECT * FROM approvals WHERE id = $1 AND user_id = $2", [id, userId])).rows[0] as Row | undefined;
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
      });
    },
    async settleApproval(userId, id, status) {
      if (!isUuid(id)) return false;
      const r = await asUser(userId, (db) => db.query("UPDATE approvals SET status = $1 WHERE id = $2 AND user_id = $3 AND status = 'pending'", [status, id, userId]));
      return r.rowCount === 1;
    },
    async pendingApprovals(userId, conversationId) {
      if (!isUuid(conversationId)) return [];
      return asUser(userId, async (db) =>
        ((await db.query("SELECT id FROM approvals WHERE user_id = $1 AND conversation_id = $2 AND status = 'pending'", [userId, conversationId])).rows as Row[]).map((r) => String(r.id)),
      );
    },
  };
}
