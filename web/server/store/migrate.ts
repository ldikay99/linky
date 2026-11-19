/**
 * Migraciones versionadas del almacenamiento. Cada motor tiene su carpeta (migrations/sqlite, migrations/postgres)
 * con archivos `NNNN_nombre.sql` numerados desde 0001, sin huecos. La tabla `schema_migrations` registra versión,
 * nombre, huella y fecha de cada una; al arrancar se aplican las pendientes, cada una en su transacción.
 * Reglas: una migración aplicada no se edita (si su huella cambia, la web no arranca) y una base más nueva que el
 * código tampoco arranca (evita que una versión vieja escriba sobre un esquema que no conoce).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../security/crypto.js";

export type Dialect = "sqlite" | "postgres";
export type Migration = { version: number; name: string; sql: string; checksum: string };
export type Applied = { version: number; name: string; checksum: string };
export type MigrationResult = { applied: number[]; version: number; existing: boolean };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Huella del contenido con saltos de línea normalizados: un checkout de Windows (CRLF) no cuenta como cambio. */
export const checksumOf = (sql: string) => sha256(sql.replace(/\r\n/g, "\n"));

export function loadMigrations(dialect: Dialect, dir = path.join(HERE, "migrations", dialect)): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const out: Migration[] = files.map((f) => {
    const m = FILE.exec(f);
    if (!m) throw new Error(`Migración con nombre inválido: ${f} (formato NNNN_nombre.sql).`);
    const sql = readFileSync(path.join(dir, f), "utf8");
    return { version: Number(m[1]), name: m[2], sql, checksum: checksumOf(sql) };
  });
  out.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migraciones de ${dialect} sin orden: se esperaba la ${i + 1} y llegó la ${m.version}.`);
  });
  if (!out.length) throw new Error(`No hay migraciones de ${dialect}.`);
  return out;
}

/** Qué falta aplicar, verificando que lo aplicado coincide con los archivos. */
export function pending(migrations: Migration[], applied: Applied[]): Migration[] {
  const known = new Map(migrations.map((m) => [m.version, m]));
  for (const a of applied) {
    const m = known.get(a.version);
    if (!m) {
      throw new Error(`La base está en la versión ${Math.max(...applied.map((x) => x.version))} y esta Linky solo conoce hasta la ${migrations.length}: actualiza Linky.`);
    }
    if (m.checksum !== a.checksum) throw new Error(`La migración ${String(a.version).padStart(4, "0")}_${a.name} cambió después de aplicarse; crea una migración nueva en vez de editarla.`);
  }
  const done = new Set(applied.map((a) => a.version));
  return migrations.filter((m) => !done.has(m.version));
}
