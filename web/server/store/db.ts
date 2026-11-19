/**
 * Persistencia de la web detrás de la interfaz Store (ver types.ts).
 * - Sin DATABASE_URL: SQLite en el directorio de datos (equipo de una persona, sin servicios extra).
 * - Con DATABASE_URL: PostgreSQL (servidor del área), con Row Level Security por persona.
 * En los dos, el esquema sale de migraciones versionadas aplicadas al arrancar y el contenido va cifrado por persona.
 */
import type { KeyRing } from "../security/crypto.js";
import type { MigrationResult } from "./migrate.js";
import type { DatabaseConfig, Store } from "./types.js";

export type * from "./types.js";

export type OpenedStore = Store & { migration: MigrationResult; warnings: string[] };

export async function openStore(dataDir: string, keys: KeyRing, database?: DatabaseConfig | null): Promise<OpenedStore> {
  if (database) {
    const { openPostgresStore } = await import("./postgres.js");
    return openPostgresStore(database, keys);
  }
  const { openSqliteStore } = await import("./sqlite.js");
  return { ...openSqliteStore(dataDir, keys), warnings: [] };
}
