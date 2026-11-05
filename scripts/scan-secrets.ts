/**
 * Escaneo local: busca patrones de secretos en el árbol (sin imprimir matches sensibles).
 * Exit 1 si encuentra candidatos peligrosos en archivos trackeables.
 */
import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SKIP = new Set(["node_modules", ".git", ".linky-demo", "browser-profiles", "dist", "coverage", "private-ripor"]);

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "auth-token-cookie", re: /sb-[a-z0-9]+-auth-token/i },
  { name: "bearer-jwt", re: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\./ },
  { name: "azure-pat-header", re: /Basic\s+[A-Za-z0-9+/=]{20,}/ },
  { name: "password-url", re: /https?:\/\/[^\/\s]+:[^@\/\s]+@/ },
];

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir);
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const s = await lstat(p);
    if (s.isSymbolicLink()) throw new Error("Symlink in scan tree: refusing to follow external state.");
    if (s.isDirectory()) await walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs|json|md|txt|yml|yaml)$/i.test(name)) out.push(p);
  }
  return out;
}

const ALLOW_PASSWORD_URL_FIXTURE = new Set([
  // Tests that assert rejection of credentialed URLs (fixtures only).
  "tests/orgUrl.test.ts",
  "tests/ripor-policy.test.ts",
]);

async function main() {
  const files = await walk(ROOT);
  let hits = 0;
  const summary: Array<{ file: string; name: string }> = [];
  for (const f of files) {
    // Never print file contents
    let text: string;
    try {
      text = await readFile(f, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(ROOT, f);
    for (const { name, re } of PATTERNS) {
      if (re.test(text)) {
        if (name === "password-url" && ALLOW_PASSWORD_URL_FIXTURE.has(rel)) continue;
        hits++;
        summary.push({ file: rel, name });
      }
    }
  }
  console.log(JSON.stringify({ scannedFiles: files.length, hits, summary }, null, 2));
  if (hits > 0) process.exit(1);
}

main().catch((e) => {
  console.error(String((e as Error).message || e));
  process.exit(1);
});
