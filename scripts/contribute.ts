/**
 * Contribuir a Linky en un comando (lo usa la IA de cada persona):
 *   npm run contribute -- --topic "<tema>" --title "<título del PR>" [--summary "<qué cambia>"] [--dry-run]
 *
 * 1. Valida: typecheck, tests y escáner de secretos (si algo falla, no sube nada).
 * 2. Rama de la persona: contrib/<usuario-github>/<tema> (la reutiliza si ya está en ella).
 * 3. Commit con su identidad git. Push al repo (si tiene escritura) o a su fork.
 * 4. Abre (o actualiza) el PR contra main. NUNCA integra: el mantenedor aprueba.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { contribBranch, needsFork, prBody } from "../agent/lib/contrib/branch.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (flag: string) => process.argv.includes(flag);
const dry = has("--dry-run");

function out(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function run(cmd: string, args: string[]): void {
  if (dry) {
    console.log(`[dry-run] ${cmd} ${args.join(" ")}`);
    return;
  }
  execFileSync(cmd, args, { stdio: "inherit" });
}
function check(name: string, script: string): { name: string; ok: boolean } {
  console.log(`\n▶ ${name}`);
  // Scripts fijos de package.json (sin entrada del usuario): shell solo para resolver npm en Windows.
  const r = spawnSync(`npm run -s ${script}`, { stdio: "inherit", shell: true });
  return { name, ok: r.status === 0 };
}

function main() {
  const topic = arg("--topic") ?? "";
  const title = arg("--title");
  if (!title) throw new Error('Uso: npm run contribute -- --topic "<tema>" --title "<título del PR>" [--summary "…"] [--dry-run]');

  try {
    out("gh", ["auth", "status"]);
  } catch {
    throw new Error("GitHub CLI sin sesión. Ejecuta: gh auth login");
  }
  const login = out("gh", ["api", "user", "--jq", ".login"]);
  const repo = JSON.parse(out("gh", ["repo", "view", "--json", "nameWithOwner,viewerPermission,defaultBranchRef"])) as {
    nameWithOwner: string;
    viewerPermission?: string;
    defaultBranchRef?: { name: string };
  };
  const base = repo.defaultBranchRef?.name ?? "main";
  const current = out("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = contribBranch(login, topic, current);

  const checks = [check("Typecheck", "typecheck"), check("Tests", "test"), check("Escáner de secretos", "scan")];
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) throw new Error(`No se sube nada: falló ${failed.map((c) => c.name).join(", ")}. Corrige y repite.`);

  if (current !== branch) run("git", ["checkout", "-b", branch]);
  run("git", ["add", "-A"]);
  const staged = out("git", ["diff", "--cached", "--name-only"]);
  if (staged) run("git", ["commit", "-m", title]);
  else console.log("Sin cambios nuevos para commit; se sube la rama tal como está.");

  const fork = needsFork(repo.viewerPermission);
  let remote = "origin";
  let head = branch;
  if (fork) {
    const remotes = out("git", ["remote"]).split(/\s+/);
    if (!remotes.includes("fork")) run("gh", ["repo", "fork", "--remote", "--remote-name", "fork"]);
    remote = "fork";
    head = `${login}:${branch}`;
  }
  run("git", ["push", "-u", remote, branch]);

  let existing = "";
  try {
    existing = out("gh", ["pr", "view", branch, "--json", "url", "--jq", ".url"]);
  } catch {
    existing = "";
  }
  if (existing) {
    console.log(`\nPR actualizado: ${existing}`);
    return;
  }
  const body = prBody({ summary: arg("--summary") ?? "", checks, author: login });
  run("gh", ["pr", "create", "--base", base, "--head", head, "--title", title, "--body", body]);
  console.log(
    dry
      ? `\n[dry-run] Se abriría un PR desde ${head} hacia ${repo.nameWithOwner}:${base}. No se subió nada.`
      : `\nPR abierto desde ${head} hacia ${repo.nameWithOwner}:${base}. Queda pendiente de aprobación del mantenedor.`,
  );
}

try {
  main();
} catch (e) {
  console.error(String((e as Error).message || e));
  process.exitCode = 1;
}
