import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Raíz del repo Linky (si se detecta). data-dir NO puede quedar dentro.
 */
export function detectLinkyRepoRoot(start?: string): string | null {
  let cur = path.resolve(start ?? process.cwd());
  for (let i = 0; i < 12; i++) {
    const pkg = path.join(cur, "package.json");
    const agentLib = path.join(cur, "agent", "lib");
    if (existsSync(pkg) && existsSync(agentLib)) {
      try {
        const name = JSON.parse(readFileSync(pkg, "utf8")).name as string;
        if (name === "linky") return cur;
      } catch {
        /* fall through */
      }
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/** Resolve existing ancestors too, so symlink + nonexistent leaf cannot bypass containment. */
export function canonicalPath(value: string): string {
  let ancestor = path.resolve(value);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("Cannot canonicalize data directory");
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.join(realpathSync(ancestor), ...suffix);
}

export function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Directorio de datos canónico FUERA del repo.
 * Default ~/.linky. Override rechazado si cae dentro del repo Linky.
 */
export function linkyDataDir(override?: string): string {
  const raw = override ?? process.env.LINKY_DATA_DIR;
  const resolved = canonicalPath(raw ? path.resolve(raw) : path.join(homedir(), ".linky"));
  const repo = detectLinkyRepoRoot(path.dirname(fileURLToPath(import.meta.url)))
    ?? detectLinkyRepoRoot(process.cwd());
  if (repo && isPathInside(resolved, repo)) {
    throw new Error(
      `LINKY data-dir rechazado: ${resolved} está dentro del repo (${repo}). ` +
        `Use una ruta fuera del repo (p.ej. ~/.linky o directorio bajo /tmp).`,
    );
  }
  return resolved;
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
