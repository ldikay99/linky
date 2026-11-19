/**
 * Backends del store para las pruebas. SQLite siempre; PostgreSQL solo si hay LINKY_TEST_DATABASE_URL
 * (`npm run web:test:pg` levanta el contenedor y la fija). Cada store de PostgreSQL vive en un esquema propio
 * que se borra al terminar, así las pruebas no se pisan ni dejan rastro.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { KeyRing } from "../server/security/crypto.js";
import { openStore, type DatabaseConfig, type OpenedStore } from "../server/store/db.js";
import { connectionOptions } from "../server/store/postgres.js";

export type Backend = "sqlite" | "postgres";

const url = process.env.LINKY_TEST_DATABASE_URL?.trim();
const passwordFile = process.env.LINKY_TEST_DATABASE_PASSWORD_FILE;

export const PG: DatabaseConfig | null = url ? { url, password: passwordFile ? readFileSync(passwordFile, "utf8").trim() : undefined } : null;
export const BACKENDS: Backend[] = PG ? ["sqlite", "postgres"] : ["sqlite"];
export const PG_SKIP_NOTE = "PostgreSQL: pruebas saltadas porque falta LINKY_TEST_DATABASE_URL. Córrelas con `npm run web:test:pg` (contenedor real).";

const schemas = new Set<string>();
const opened: OpenedStore[] = [];

/** Cierre idempotente: la prueba puede cerrar antes y el cierre general no falla. */
function track(store: OpenedStore): OpenedStore {
  const close = store.close;
  let closed = false;
  store.close = async () => {
    if (closed) return;
    closed = true;
    await close();
  };
  opened.push(store);
  return store;
}

export async function closeTestStores() {
  for (const s of opened.splice(0)) await s.close().catch(() => undefined);
}

export type TestStore = { store: OpenedStore; dir: string; keys: KeyRing; backend: Backend; schema?: string };

export async function openTestStore(backend: Backend, opts: { keys?: KeyRing; schema?: string; dir?: string } = {}): Promise<TestStore> {
  const dir = opts.dir ?? (await mkdtemp(path.join(tmpdir(), "linky-store-")));
  const keys = opts.keys ?? new KeyRing(randomBytes(32));
  if (backend === "sqlite") return { store: track(await openStore(dir, keys)), dir, keys, backend };
  if (!PG) throw new Error(PG_SKIP_NOTE);
  const schema = opts.schema ?? newSchema();
  return { store: track(await openStore(dir, keys, { ...PG, schema })), dir, keys, backend, schema };
}

export function newSchema() {
  const s = `prueba_${randomBytes(6).toString("hex")}`;
  schemas.add(s);
  return s;
}

/** Conexión directa (sin el store) para mirar la base como lo haría alguien con acceso a ella. */
export function rawPool(schema?: string) {
  if (!PG) throw new Error(PG_SKIP_NOTE);
  return new pg.Pool({ ...connectionOptions({ ...PG, schema }), max: 2 });
}

export async function dropTestSchemas() {
  if (!PG || !schemas.size) return;
  const pool = rawPool();
  try {
    for (const s of schemas) await pool.query(`DROP SCHEMA IF EXISTS ${pg.escapeIdentifier(s)} CASCADE`);
    schemas.clear();
  } finally {
    await pool.end();
  }
}
