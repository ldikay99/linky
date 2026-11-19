import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { UiMessage } from "../shared/protocol.js";
import { KeyRing, sha256 } from "../server/security/crypto.js";
import { checksumOf, loadMigrations, pending, type Dialect } from "../server/store/migrate.js";
import { connectionOptions, migratePostgres } from "../server/store/postgres.js";
import { SQLITE_FILE, migrateSqlite } from "../server/store/sqlite.js";
import type { StoredHistory } from "../server/store/types.js";
import { BACKENDS, PG, closeTestStores, dropTestSchemas, newSchema, openTestStore, rawPool, type TestStore } from "./stores.js";

afterEach(closeTestStores);
afterAll(dropTestSchemas);

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server/store/migrations");
const VERSION = loadMigrations("sqlite").length;
const ALL = Array.from({ length: VERSION }, (_, i) => i + 1);
// Texto que no puede aparecer por casualidad en ids, hashes ni cifrados.
const SECRET = "Confidencial-Ñandú-Zeta-Persona";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = () => sha256(randomBytes(16));
const csrf = () => randomBytes(24).toString("base64url");

/** Todo lo que guarda la base, en bytes, como lo vería alguien con acceso directo a ella (en PostgreSQL, como la persona). */
async function rawDump(t: TestStore, userId: string): Promise<{ bytes: Buffer; rows: number }> {
  if (t.backend === "sqlite") {
    const parts: Buffer[] = [];
    for (const f of readdirSync(t.dir).filter((n) => n.startsWith(SQLITE_FILE))) parts.push(await readFile(path.join(t.dir, f)));
    return { bytes: Buffer.concat(parts), rows: -1 };
  }
  const pool = rawPool(t.schema);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('linky.user_id', $1, true)", [userId]);
    const parts: Buffer[] = [];
    let rows = 0;
    for (const table of ["users", "sessions", "conversations", "files", "approvals", "memories", "audit"]) {
      for (const row of (await c.query(`SELECT * FROM ${table}`)).rows as Record<string, unknown>[]) {
        rows++;
        for (const v of Object.values(row)) parts.push(Buffer.isBuffer(v) ? v : Buffer.from(String(v)));
      }
    }
    await c.query("COMMIT");
    return { bytes: Buffer.concat(parts), rows };
  } finally {
    c.release();
    await pool.end();
  }
}

/** Copia de las migraciones reales para alterarlas en una prueba. */
function migrationsCopy(dialect: Dialect) {
  const dir = mkdtempSync(path.join(tmpdir(), `linky-mig-${dialect}-`));
  cpSync(path.join(MIGRATIONS, dialect), dir, { recursive: true });
  return dir;
}

describe("migraciones versionadas", () => {
  it("cada motor tiene su historia numerada desde 0001 y la misma versión del modelo", () => {
    const sqlite = loadMigrations("sqlite");
    const postgres = loadMigrations("postgres");
    expect(sqlite.map((m) => m.version)).toEqual(ALL);
    expect(postgres.map((m) => m.version)).toEqual(ALL);
    expect(sqlite.map((m) => m.name)).toEqual(postgres.map((m) => m.name));
  });

  it("una migración aplicada no se edita y una base más nueva que el código no arranca", () => {
    const ms = loadMigrations("sqlite");
    const applied = ms.map((m) => ({ version: m.version, name: m.name, checksum: m.checksum }));
    expect(pending(ms, applied)).toEqual([]);
    expect(pending(ms, applied.slice(0, 1)).map((m) => m.version)).toEqual(ALL.slice(1));
    expect(() => pending(ms, [{ ...applied[0], checksum: "otra" }])).toThrow(/cambió después de aplicarse/);
    expect(() => pending(ms, [...applied, { version: VERSION + 1, name: "futura", checksum: "x" }])).toThrow(/actualiza Linky/);
  });

  it("la huella no cambia con los saltos de línea de Windows", () => {
    expect(checksumOf("CREATE TABLE a (b int);\r\nSELECT 1;\r\n")).toBe(checksumOf("CREATE TABLE a (b int);\nSELECT 1;\n"));
  });

  it("los nombres de archivo y el orden se validan", () => {
    const dir = migrationsCopy("sqlite");
    writeFileSync(path.join(dir, `${String(VERSION + 2).padStart(4, "0")}_con_hueco.sql`), "SELECT 1;");
    expect(() => loadMigrations("sqlite", dir)).toThrow(/sin orden/);
    const bad = migrationsCopy("sqlite");
    writeFileSync(path.join(bad, "9_Mal-Nombre.sql"), "SELECT 1;");
    expect(() => loadMigrations("sqlite", bad)).toThrow(/nombre inválido/);
  });
});

describe("conexión a PostgreSQL: reglas de transporte", () => {
  it("en loopback va sin TLS; fuera de loopback, con verify-full", () => {
    expect(connectionOptions({ url: "postgres://linky@127.0.0.1:5478/linky" }).ssl).toBe(false);
    expect(connectionOptions({ url: "postgres://linky@localhost/linky" }).ssl).toBe(false);
    const remote = connectionOptions({ url: "postgres://linky@db.empresa.co/linky" });
    expect(remote.ssl).toMatchObject({ rejectUnauthorized: true, servername: "db.empresa.co" });
    expect(connectionOptions({ url: "postgres://linky@10.0.0.5/linky" }).ssl).toMatchObject({ rejectUnauthorized: true, host: "10.0.0.5" });
    expect(connectionOptions({ url: "postgres://linky@db.empresa.co/linky", ca: "PEM" }).ssl).toMatchObject({ ca: "PEM" });
    expect(connectionOptions({ url: "postgres://linky@127.0.0.1/linky?sslmode=verify-full" }).ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("los modos que no verifican el certificado se rechazan, y sin TLS solo con permiso explícito", () => {
    for (const mode of ["require", "prefer", "allow", "verify-ca"]) {
      expect(() => connectionOptions({ url: `postgres://linky@db.empresa.co/linky?sslmode=${mode}` })).toThrow(/verify-full/);
    }
    expect(() => connectionOptions({ url: "postgres://linky@postgres:5432/linky?sslmode=disable" })).toThrow(/exige TLS/);
    expect(connectionOptions({ url: "postgres://linky@postgres:5432/linky?sslmode=disable", allowPlaintext: true }).ssl).toBe(false);
    // El permiso no apaga TLS por sí solo: sin sslmode=disable sigue siendo verify-full.
    expect(connectionOptions({ url: "postgres://linky@db.empresa.co/linky", allowPlaintext: true }).ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("toma usuario, base y contraseña de la URL, y la del archivo de secreto tiene prioridad", () => {
    const o = connectionOptions({ url: "postgresql://usu%40rio:de%20url@127.0.0.1:6000/mi%20base" });
    expect(o).toMatchObject({ host: "127.0.0.1", port: 6000, user: "usu@rio", password: "de url", database: "mi base", application_name: "linky-web" });
    expect(connectionOptions({ url: "postgres://linky:de-url@127.0.0.1/linky", password: "del-archivo" }).password).toBe("del-archivo");
    expect(connectionOptions({ url: "postgres://linky@127.0.0.1/linky", schema: "prueba_1" }).options).toBe("-c search_path=prueba_1");
  });

  it("URL inválida, otro protocolo, sin base o esquema raro: no arranca", () => {
    expect(() => connectionOptions({ url: "no es url" })).toThrow(/no es una URL válida/);
    expect(() => connectionOptions({ url: "mysql://x@127.0.0.1/linky" })).toThrow(/postgres:\/\//);
    expect(() => connectionOptions({ url: "postgres://x@127.0.0.1" })).toThrow(/servidor y la base/);
    expect(() => connectionOptions({ url: "postgres://x@127.0.0.1/linky", schema: "a; DROP" })).toThrow(/esquema inválido/);
  });
});

describe.each(BACKENDS)("store en %s", (backend) => {
  it("arranca en la versión actual y al reabrir no vuelve a migrar", async () => {
    const t = await openTestStore(backend);
    expect(t.store.backend).toBe(backend);
    expect(t.store.migration).toEqual({ applied: ALL, version: VERSION, existing: false });
    const u = await t.store.createUser("Persona", null, "member");
    await t.store.close();
    const again = await openTestStore(backend, { dir: t.dir, keys: t.keys, schema: t.schema });
    expect(again.store.migration.applied).toEqual([]);
    expect((await again.store.userById(u.id))?.name).toBe("Persona");
  });

  it("personas: crear, buscar, actualizar y dueña", async () => {
    const { store } = await openTestStore(backend);
    expect(await store.owner()).toBeNull();
    const owner = await store.createUser("Dueña", null, "owner");
    const m = await store.createUser("Persona", "persona@empresa.co", "member");
    expect(await store.owner()).toMatchObject({ id: owner.id, role: "owner", onboarded: false });
    await store.updateUser(m.id, { name: "Persona Nueva", onboarded: true });
    expect(await store.userById(m.id)).toMatchObject({ name: "Persona Nueva", email: "persona@empresa.co", role: "member", onboarded: true });
    expect(Math.abs(m.createdAt - Date.now())).toBeLessThan(60_000);
    expect(await store.userById(randomUUID())).toBeNull();
    expect(await store.userById("no-es-un-uuid")).toBeNull();
    await store.audit(m.id, "prueba.ok", "1");
    await store.audit(null, "sistema.ok");
  });

  it("sesiones: se guardan por hash, vencen y se borran", async () => {
    const { store } = await openTestStore(backend);
    const u = await store.createUser("Persona", null, "member");
    const [h, expired, purged, token] = [hash(), hash(), hash(), csrf()];
    await store.createSession(h, u.id, token, 60_000);
    const s = await store.session(h);
    expect(s).toMatchObject({ userId: u.id, csrf: token });
    expect(s!.expiresAt).toBeGreaterThan(Date.now());
    await store.createSession(expired, u.id, csrf(), 20);
    await store.createSession(purged, u.id, csrf(), 20);
    await sleep(60);
    expect(await store.session(expired)).toBeNull();
    await store.purgeExpired();
    expect(await store.session(purged)).toBeNull();
    expect(await store.session(h)).not.toBeNull();
    await store.deleteSession(h);
    expect(await store.session(h)).toBeNull();
    expect(await store.session(hash())).toBeNull();
  });

  it("invitaciones: un solo uso y con vencimiento", async () => {
    const { store } = await openTestStore(backend);
    const u = await store.createUser("Persona", null, "member");
    const [ok, late] = [hash(), hash()];
    await store.createInvite(ok, u.id, 60_000);
    await store.createInvite(late, u.id, 20);
    expect(await store.consumeInvite(ok)).toBe(u.id);
    expect(await store.consumeInvite(ok)).toBeNull();
    await sleep(60);
    expect(await store.consumeInvite(late)).toBeNull();
    expect(await store.consumeInvite(hash())).toBeNull();
    await store.purgeExpired();
  });

  it("conversaciones: crear, guardar, renombrar, listar y borrar, cada persona solo lo suyo", async () => {
    const { store } = await openTestStore(backend);
    const a = await store.createUser("A", null, "member");
    const b = await store.createUser("B", null, "member");
    const c1 = await store.createConversation(a.id, "Primera");
    await sleep(5);
    const c2 = await store.createConversation(a.id, "Segunda");
    await store.createConversation(b.id, "De B");
    expect((await store.listConversations(a.id)).map((c) => c.title)).toEqual(["Segunda", "Primera"]);

    const transcript: UiMessage[] = [{ id: randomUUID(), role: "user", createdAt: Date.now(), text: SECRET, attachments: [] }];
    const history: StoredHistory = { messages: [{ role: "user", content: [{ type: "text", text: SECRET }] }], previews: { azure_day_preview: "{}" }, summary: "resumen", summarizedUpTo: 1 };
    await sleep(5);
    await store.saveConversation(a.id, c1, { transcript, history });
    const saved = await store.conversation(a.id, c1);
    expect(saved).toMatchObject({ title: "Primera", transcript, history });
    expect((await store.listConversations(a.id))[0].id).toBe(c1);

    expect(await store.renameConversation(a.id, c1, "Renombrada")).toBe(true);
    expect((await store.conversation(a.id, c1))?.title).toBe("Renombrada");
    // Otra persona no ve, no renombra y no borra.
    expect(await store.conversation(b.id, c1)).toBeNull();
    expect(await store.renameConversation(b.id, c1, "x")).toBe(false);
    expect(await store.deleteConversation(b.id, c1)).toBe(false);
    await store.saveConversation(b.id, c1, { transcript: [], history: { messages: [], previews: {} } });
    expect((await store.conversation(a.id, c1))?.transcript).toEqual(transcript);
    expect((await store.listConversations(b.id)).map((c) => c.title)).toEqual(["De B"]);

    expect(await store.deleteConversation(a.id, c2)).toBe(true);
    expect(await store.conversation(a.id, c2)).toBeNull();
    expect(await store.renameConversation(a.id, "no-es-un-uuid", "x")).toBe(false);
    expect(await store.conversation(a.id, "no-es-un-uuid")).toBeNull();
  });

  it("aprobaciones: se resuelven una sola vez y se van con su conversación", async () => {
    const { store } = await openTestStore(backend);
    const u = await store.createUser("Persona", null, "member");
    const other = await store.createUser("Otra", null, "member");
    const conv = await store.createConversation(u.id, "Con aprobación");
    const id = randomUUID();
    const input = { snapshotHash: "abc", nota: SECRET };
    await store.addApproval({ id, userId: u.id, conversationId: conv, toolCallId: "toolu_01", toolName: "azure_day_apply", input });
    expect(await store.approval(u.id, id)).toEqual({ id, userId: u.id, conversationId: conv, toolCallId: "toolu_01", toolName: "azure_day_apply", input, status: "pending" });
    expect(await store.pendingApprovals(u.id, conv)).toEqual([id]);
    expect(await store.approval(other.id, id)).toBeNull();
    expect(await store.settleApproval(other.id, id, "approved")).toBe(false);
    expect(await store.settleApproval(u.id, id, "approved")).toBe(true);
    expect(await store.settleApproval(u.id, id, "rejected")).toBe(false);
    expect((await store.approval(u.id, id))?.status).toBe("approved");
    expect(await store.pendingApprovals(u.id, conv)).toEqual([]);
    await store.deleteConversation(u.id, conv);
    expect(await store.approval(u.id, id)).toBeNull();
  });

  it("memoria: recuerdos y fragmentos con vector, borrado por persona y con su conversación", async () => {
    const { store } = await openTestStore(backend);
    const u = await store.createUser("Persona", null, "member");
    const other = await store.createUser("Otra", null, "member");
    const conv = await store.createConversation(u.id, "PQRD");
    const fact = randomUUID();
    const chunk = randomUUID();
    await store.addMemory({ id: fact, userId: u.id, kind: "fact", conversationId: null, text: SECRET, vector: [0.25, -0.5, 1] });
    await store.addMemory({ id: chunk, userId: u.id, kind: "chunk", conversationId: conv, text: "Persona: registra PQRD", vector: null });
    expect(await store.memories(u.id, "fact")).toEqual([{ id: fact, kind: "fact", conversationId: null, text: SECRET, vector: [0.25, -0.5, 1], createdAt: expect.any(Number) }]);
    expect((await store.memories(u.id, "chunk"))[0]).toMatchObject({ id: chunk, conversationId: conv, vector: null });
    expect(await store.memories(u.id)).toHaveLength(2);
    expect(await store.memories(other.id)).toEqual([]);
    expect(await store.countMemories(u.id, "chunk")).toBe(1);

    expect(await store.deleteMemory(u.id, chunk)).toBe(false); // los fragmentos se van con su conversación
    expect(await store.deleteMemory(other.id, fact)).toBe(false);
    expect(await store.deleteMemory(u.id, fact)).toBe(true);
    for (const text of ["uno", "dos", "tres"]) await store.addMemory({ id: randomUUID(), userId: u.id, kind: "fact", conversationId: null, text, vector: null });
    expect(await store.memories(u.id, "fact", 2)).toHaveLength(2);
    expect(await store.deleteMemories(u.id, "fact")).toBe(3);
    await store.deleteConversation(u.id, conv);
    expect(await store.countMemories(u.id, "chunk")).toBe(0);
  });

  it("adjuntos y borrar los datos de una persona sin tocar los de otra", async () => {
    const { store } = await openTestStore(backend);
    const a = await store.createUser("A", null, "member");
    const b = await store.createUser("B", null, "member");
    const file = { id: randomUUID(), userId: a.id, name: `${SECRET}.png`, mediaType: "image/png", kind: "image", size: 1234, sha256: sha256("png"), createdAt: Date.now() };
    await store.addFile(file);
    expect(await store.file(a.id, file.id)).toEqual(file);
    expect(await store.file(b.id, file.id)).toBeNull();
    expect(await store.file(a.id, "no-es-un-uuid")).toBeNull();
    const c1 = await store.createConversation(a.id, "uno");
    await store.createConversation(a.id, "dos");
    await store.createConversation(b.id, "de B");
    await store.addMemory({ id: randomUUID(), userId: a.id, kind: "chunk", conversationId: c1, text: "fragmento", vector: null });
    await store.addApproval({ id: randomUUID(), userId: a.id, conversationId: c1, toolCallId: "t1", toolName: "ripor_apply", input: {} });
    expect(await store.deleteUserData(a.id)).toEqual({ conversations: 2, files: 1 });
    expect(await store.listConversations(a.id)).toEqual([]);
    expect(await store.file(a.id, file.id)).toBeNull();
    expect(await store.countMemories(a.id, "chunk")).toBe(0);
    expect((await store.listConversations(b.id)).map((c) => c.title)).toEqual(["de B"]);
  });

  it("el contenido de la persona no queda en claro en la base", async () => {
    const t = await openTestStore(backend);
    const { store } = t;
    const u = await store.createUser("Persona Visible", null, "member");
    const conv = await store.createConversation(u.id, SECRET);
    await store.saveConversation(u.id, conv, { transcript: [{ id: randomUUID(), role: "user", createdAt: Date.now(), text: SECRET, attachments: [] }], history: { messages: [SECRET], previews: {} } });
    await store.addFile({ id: randomUUID(), userId: u.id, name: SECRET, mediaType: "text/plain", kind: "text", size: 1, sha256: sha256("a"), createdAt: Date.now() });
    await store.addMemory({ id: randomUUID(), userId: u.id, kind: "fact", conversationId: null, text: SECRET, vector: [0.123456789] });
    await store.addApproval({ id: randomUUID(), userId: u.id, conversationId: conv, toolCallId: "t", toolName: "chat_send", input: { texto: SECRET } });
    const dump = await rawDump(t, u.id);
    expect(dump.bytes.includes(Buffer.from("Persona Visible"))).toBe(true); // el volcado es real
    if (backend === "postgres") expect(dump.rows).toBeGreaterThanOrEqual(5); // con la persona fijada, RLS deja ver sus filas
    for (const plain of [SECRET, "0.123456789"]) expect(dump.bytes.includes(Buffer.from(plain))).toBe(false);
  });

  it("una migración que falla no deja nada a medias", async () => {
    const dir = migrationsCopy(backend);
    writeFileSync(path.join(dir, `${String(VERSION + 1).padStart(4, "0")}_rota.sql`), "CREATE TABLE a_medias (a integer);\nSELECT * FROM tabla_que_no_existe;\n");
    if (backend === "sqlite") {
      const t = await openTestStore("sqlite");
      await t.store.close();
      const db = new DatabaseSync(path.join(t.dir, SQLITE_FILE));
      try {
        expect(() => migrateSqlite(db, dir)).toThrow(/No se pudo aplicar la migración/);
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a_medias'").get()).toBeUndefined();
        expect(Number((db.prepare("SELECT max(version) AS v FROM schema_migrations").get() as { v: number }).v)).toBe(VERSION);
      } finally {
        db.close();
      }
      return;
    }
    const t = await openTestStore("postgres");
    const pool = rawPool(t.schema);
    try {
      await expect(migratePostgres(pool, t.schema, dir)).rejects.toThrow(/No se pudo aplicar la migración/);
      expect((await pool.query("SELECT to_regclass('a_medias') AS t")).rows[0].t).toBeNull();
      expect((await pool.query("SELECT max(version) AS v FROM schema_migrations")).rows[0].v).toBe(VERSION);
    } finally {
      await pool.end();
    }
  });

  it("una migración editada después de aplicarse impide arrancar", async () => {
    const dir = migrationsCopy(backend);
    writeFileSync(path.join(dir, "0001_esquema_inicial.sql"), "-- editada\nSELECT 1;\n");
    if (backend === "sqlite") {
      const t = await openTestStore("sqlite");
      await t.store.close();
      const db = new DatabaseSync(path.join(t.dir, SQLITE_FILE));
      try {
        expect(() => migrateSqlite(db, dir)).toThrow(/cambió después de aplicarse/);
      } finally {
        db.close();
      }
      return;
    }
    const t = await openTestStore("postgres");
    const pool = rawPool(t.schema);
    try {
      await expect(migratePostgres(pool, t.schema, dir)).rejects.toThrow(/cambió después de aplicarse/);
    } finally {
      await pool.end();
    }
  });
});

// Esquema exacto que creaba db.ts antes de las migraciones (bases de quien ya usa la web).
const LEGACY_SCHEMA = `
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
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  text BLOB NOT NULL, vector BLOB, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS memories_user ON memories(user_id, kind, created_at DESC);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL);
`;

describe("SQLite: bases creadas antes de las migraciones", () => {
  it("se reconocen como versión 1, se ponen al día y sus datos se siguen leyendo", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "linky-legacy-"));
    const keys = new KeyRing(randomBytes(32));
    const userId = randomUUID();
    const convId = randomUUID();
    const memId = randomUUID();
    const t0 = Date.now() - 86_400_000;
    const old = new DatabaseSync(path.join(dir, SQLITE_FILE));
    old.exec(LEGACY_SCHEMA);
    // Filas tal como las escribía la versión anterior (mismas AAD).
    old.prepare("INSERT INTO users (id, name, email, role, onboarded, created_at) VALUES (?, 'Dueña de antes', NULL, 'owner', 1, ?)").run(userId, t0);
    old.prepare("INSERT INTO conversations (id, user_id, title, transcript, history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      convId,
      userId,
      keys.seal(userId, "data", `conv-title:${convId}`, "Antes de migrar"),
      keys.sealJson(userId, `conv-transcript:${convId}`, []),
      keys.sealJson(userId, `conv-history:${convId}`, { messages: [], previews: {} }),
      t0,
      t0,
    );
    old.prepare("INSERT INTO memories (id, user_id, kind, conversation_id, text, vector, created_at) VALUES (?, ?, 'fact', NULL, ?, ?, ?)").run(
      memId,
      userId,
      keys.seal(userId, "data", `mem:${memId}`, "Prefiere descripciones cortas"),
      keys.sealJson(userId, `mem-vec:${memId}`, [1, 0]),
      t0,
    );
    old.close();

    const t = await openTestStore("sqlite", { dir, keys });
    expect(t.store.migration).toEqual({ applied: ALL, version: VERSION, existing: true });
    expect(await t.store.owner()).toMatchObject({ id: userId, name: "Dueña de antes", onboarded: true, createdAt: t0 });
    expect(await t.store.listConversations(userId)).toEqual([{ id: convId, title: "Antes de migrar", updatedAt: t0 }]);
    expect((await t.store.memories(userId, "fact"))[0]).toMatchObject({ text: "Prefiere descripciones cortas", vector: [1, 0] });
    await t.store.close();

    const db = new DatabaseSync(path.join(dir, SQLITE_FILE));
    try {
      expect((db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((r) => r.version)).toEqual(ALL);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'approvals_pending'").get()).toBeDefined();
    } finally {
      db.close();
    }
    const again = await openTestStore("sqlite", { dir, keys });
    expect(again.store.migration).toEqual({ applied: [], version: VERSION, existing: false });
  });
});

describe.skipIf(!PG)(`PostgreSQL: aislamiento e integridad${PG ? "" : " (saltadas: falta LINKY_TEST_DATABASE_URL)"}`, () => {
  /** Ejecuta en una transacción con la persona fijada, como hace el store. */
  async function asPerson<T>(pool: ReturnType<typeof rawPool>, userId: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>) => Promise<T>) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      if (userId) await c.query("SELECT set_config('linky.user_id', $1, true)", [userId]);
      const out = await fn((sql, params) => c.query(sql, params));
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  it("el rol de la web no es superusuario ni salta RLS", async () => {
    const { store } = await openTestStore("postgres");
    expect(store.warnings).toEqual([]);
  });

  it("Row Level Security: sin persona fijada no se ve nada y cada persona solo ve y escribe lo suyo", async () => {
    const t = await openTestStore("postgres");
    const a = await t.store.createUser("A", null, "member");
    const b = await t.store.createUser("B", null, "member");
    await t.store.createConversation(a.id, "de A");
    const convB = await t.store.createConversation(b.id, "de B");
    await t.store.addMemory({ id: randomUUID(), userId: b.id, kind: "fact", conversationId: null, text: "de B", vector: null });
    const pool = rawPool(t.schema);
    try {
      for (const table of ["conversations", "memories", "files", "approvals"]) {
        expect((await asPerson(pool, null, (q) => q(`SELECT count(*)::int AS n FROM ${table}`))).rows[0].n).toBe(0);
      }
      const seen = await asPerson(pool, a.id, (q) => q("SELECT user_id FROM conversations"));
      expect(seen.rows.map((r) => r.user_id)).toEqual([a.id]);
      expect((await asPerson(pool, a.id, (q) => q("SELECT count(*)::int AS n FROM memories"))).rows[0].n).toBe(0);
      expect((await asPerson(pool, a.id, (q) => q("UPDATE conversations SET updated_at = now() WHERE id = $1", [convB]))).rowCount).toBe(0);
      expect((await asPerson(pool, a.id, (q) => q("DELETE FROM conversations WHERE id = $1", [convB]))).rowCount).toBe(0);
      const bytes = Buffer.alloc(40, 1);
      await expect(
        asPerson(pool, a.id, (q) => q("INSERT INTO conversations (id, user_id, title, transcript, history) VALUES ($1, $2, $3, $3, $3)", [randomUUID(), b.id, bytes])),
      ).rejects.toThrow(/row-level security/);
      expect(await t.store.conversation(b.id, convB)).not.toBeNull();
    } finally {
      await pool.end();
    }
  });

  it("una aprobación o un fragmento no se cuelgan de la conversación de otra persona", async () => {
    const { store } = await openTestStore("postgres");
    const a = await store.createUser("A", null, "member");
    const b = await store.createUser("B", null, "member");
    const convA = await store.createConversation(a.id, "de A");
    await expect(store.addApproval({ id: randomUUID(), userId: b.id, conversationId: convA, toolCallId: "t", toolName: "x", input: {} })).rejects.toThrow(/foreign key/);
    await expect(store.addMemory({ id: randomUUID(), userId: b.id, kind: "chunk", conversationId: convA, text: "x", vector: null })).rejects.toThrow(/foreign key/);
    await expect(store.addMemory({ id: randomUUID(), userId: a.id, kind: "fact", conversationId: convA, text: "x", vector: null })).rejects.toThrow(/check constraint/);
  });

  it("restricciones: una sola dueña, roles conocidos y la auditoría no se modifica", async () => {
    const t = await openTestStore("postgres");
    await t.store.createUser("Dueña", null, "owner");
    await expect(t.store.createUser("Otra dueña", null, "owner")).rejects.toThrow(/users_single_owner/);
    await expect(t.store.createUser("X", null, "jefe" as never)).rejects.toThrow(/check constraint/);
    await t.store.createUser("Con correo", "Persona@Empresa.co", "member");
    await expect(t.store.createUser("Mismo correo", "persona@empresa.co", "member")).rejects.toThrow(/users_email_unique/);
    await t.store.audit(null, "prueba", "uno");
    const pool = rawPool(t.schema);
    try {
      await expect(pool.query("UPDATE audit SET detail = 'otro'")).rejects.toThrow(/no se modifica/);
    } finally {
      await pool.end();
    }
  });

  it("borrar a la persona borra en cascada todo lo suyo y conserva la auditoría", async () => {
    const t = await openTestStore("postgres");
    const u = await t.store.createUser("Persona", null, "member");
    const conv = await t.store.createConversation(u.id, "uno");
    await t.store.createSession(hash(), u.id, csrf(), 60_000);
    await t.store.createInvite(hash(), u.id, 60_000);
    await t.store.addFile({ id: randomUUID(), userId: u.id, name: "a.txt", mediaType: "text/plain", kind: "text", size: 1, sha256: sha256("a"), createdAt: Date.now() });
    await t.store.addMemory({ id: randomUUID(), userId: u.id, kind: "chunk", conversationId: conv, text: "x", vector: null });
    await t.store.addApproval({ id: randomUUID(), userId: u.id, conversationId: conv, toolCallId: "t", toolName: "x", input: {} });
    await t.store.audit(u.id, "data.deleted", "0");
    const pool = rawPool(t.schema);
    try {
      await pool.query("DELETE FROM users WHERE id = $1", [u.id]);
      const counts = await asPerson(pool, u.id, async (q) => {
        const out: Record<string, number> = {};
        for (const table of ["sessions", "invites", "conversations", "files", "approvals", "memories", "audit"]) {
          out[table] = Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [u.id])).rows[0].n);
        }
        return out;
      });
      expect(counts).toEqual({ sessions: 0, invites: 0, conversations: 0, files: 0, approvals: 0, memories: 0, audit: 1 });
    } finally {
      await pool.end();
    }
  });

  it("dos instancias que arrancan a la vez migran una sola vez", async () => {
    const schema = newSchema();
    const [one, two] = await Promise.all([openTestStore("postgres", { schema }), openTestStore("postgres", { schema })]);
    expect([one.store.migration.applied, two.store.migration.applied].sort((x, y) => y.length - x.length)).toEqual([ALL, []]);
  });
});
