/**
 * Commits del día como evidencia (opcional: solo para quien desarrolla). Lee repos LOCALES con git
 * (funciona con Azure Repos y GitHub sin API) y construye enlaces web a cada commit.
 * Los remotos se sanean: nunca se imprime ni se usa una credencial incrustada en la URL.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";
import { zonedToUtc } from "../calendar/ics.js";

export type DevConfig = { version: 1; repos: string[]; authorEmails: string[] };
export type Commit = { repo: string; sha: string; short: string; time: string; message: string; url?: string; workItems: number[] };

const configPath = (dataDir?: string) => path.join(linkyDataDir(dataDir), "dev.json");

export async function loadDevConfig(dataDir?: string): Promise<DevConfig | null> {
  try {
    return JSON.parse(await readFile(configPath(dataDir), "utf8")) as DevConfig;
  } catch {
    return null;
  }
}

export async function saveDevConfig(cfg: DevConfig, dataDir?: string): Promise<void> {
  await mkdir(linkyDataDir(dataDir), { recursive: true, mode: 0o700 });
  await writeFile(configPath(dataDir), JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}

/** URL web base del repo desde el remoto (Azure Repos / GitHub), SIN credenciales. */
export function webBaseFromRemote(remote: string): string | undefined {
  const r = remote.trim().replace(/\.git$/, "");
  let m = /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)$/.exec(r);
  if (m) return `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}`;
  m = /^git@github\.com:([^/]+)\/(.+)$/.exec(r);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  try {
    const u = new URL(r);
    u.username = "";
    u.password = "";
    const host = u.hostname.toLowerCase();
    if (host === "dev.azure.com" || host.endsWith(".visualstudio.com") || host === "github.com") return `${u.origin}${u.pathname}`;
  } catch {
    /* remoto no web */
  }
  return undefined;
}

export function commitUrl(base: string | undefined, sha: string): string | undefined {
  if (!base) return undefined;
  return base.includes("github.com") ? `${base}/commit/${sha}` : `${base}/commit/${sha}`;
}

/** Work items mencionados: "AB#123" (Azure Boards) o "#123" en repos de Azure. */
export function workItemRefs(message: string, azure: boolean): number[] {
  const re = azure ? /(?:AB)?#(\d{2,7})\b/gi : /AB#(\d{2,7})\b/gi;
  return [...new Set([...message.matchAll(re)].map((m) => Number(m[1])))];
}

/** Repos git bajo una carpeta (profundidad limitada, sin node_modules). */
export async function findRepos(root: string, depth = 4): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, d: number) {
    if (d > depth) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    if (entries.includes(".git")) {
      out.push(dir);
      return;
    }
    for (const e of entries) {
      if (e.startsWith(".") || e === "node_modules" || e === "dist" || e === "build") continue;
      const p = path.join(dir, e);
      try {
        if ((await stat(p)).isDirectory()) await walk(p, d + 1);
      } catch {
        /* sin permiso */
      }
    }
  }
  await walk(path.resolve(root), 0);
  return out;
}

export function hasRecentCommits(repo: string, emails: string[], days: number): boolean {
  if (!emails.length) return false;
  try {
    const args = ["log", "--all", `--since=${days}.days.ago`, "--format=%h", "-n", "1", ...emails.map((e) => `--author=${e}`)];
    return git(repo, args).trim().length > 0;
  } catch {
    return false;
  }
}

/** Correos de autor por defecto: git config global (la persona puede añadir más). */
export function defaultAuthorEmails(): string[] {
  try {
    const e = execFileSync("git", ["config", "--global", "user.email"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    return e ? [e] : [];
  } catch {
    return [];
  }
}

export function commitsOn(input: { repos: string[]; authorEmails: string[]; dateYmd: string; timeZone: string }): Commit[] {
  const [y, m, d] = input.dateYmd.split("-").map(Number);
  const since = new Date(zonedToUtc(y, m, d, 0, 0, 0, input.timeZone)).toISOString();
  const until = new Date(zonedToUtc(y, m, d, 0, 0, 0, input.timeZone) + 86_400_000).toISOString();
  const out: Commit[] = [];
  for (const repo of input.repos) {
    let remote = "";
    try {
      remote = git(repo, ["remote", "get-url", "origin"]).trim();
    } catch {
      remote = "";
    }
    const base = webBaseFromRemote(remote);
    const azure = Boolean(base && !base.includes("github.com"));
    let log = "";
    try {
      log = git(repo, [
        "log",
        "--all",
        "--no-merges",
        `--since=${since}`,
        `--until=${until}`,
        "--format=%H%x1f%h%x1f%aI%x1f%s",
        ...input.authorEmails.map((e) => `--author=${e}`),
      ]);
    } catch {
      continue;
    }
    for (const line of log.split("\n").filter(Boolean)) {
      const [sha, short, time, message] = line.split("\x1f");
      out.push({ repo: path.basename(repo), sha, short, time, message, url: commitUrl(base, sha), workItems: workItemRefs(message, azure) });
    }
  }
  // Copias del mismo repo (clones/worktrees) repiten commits: uno por SHA.
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.sha) ? false : (seen.add(c.sha), true))).sort((a, b) => a.time.localeCompare(b.time));
}
