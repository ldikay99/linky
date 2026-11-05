import { homedir } from "node:os";
import path from "node:path";

/** Directorio de datos local fuera del repo (nunca se commitea). */
export function linkyDataDir(override?: string): string {
  if (override) return path.resolve(override);
  if (process.env.LINKY_DATA_DIR) return path.resolve(process.env.LINKY_DATA_DIR);
  return path.join(homedir(), ".linky");
}

export function profilePath(dataDir?: string): string {
  return path.join(linkyDataDir(dataDir), "profile.json");
}

export function secretsDir(dataDir?: string): string {
  return path.join(linkyDataDir(dataDir), "secrets");
}

export function idempotencyPath(dataDir?: string): string {
  return path.join(linkyDataDir(dataDir), "idempotency.json");
}

export function draftsDir(dataDir?: string): string {
  return path.join(linkyDataDir(dataDir), "drafts");
}
