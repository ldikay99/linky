/**
 * Evidencia de desarrollo (opcional): commits locales y PRs de Azure del día.
 * Solo para quien desarrolla; se activa en el onboarding con `dev scan`.
 */
import { execFileSync } from "node:child_process";
import { loadAzureOrgs } from "../azure/orgs.js";
import { commitsOn, defaultAuthorEmails, findRepos, hasRecentCommits, loadDevConfig, saveDevConfig, webBaseFromRemote, type Commit } from "../dev/git.js";
import { azureProjectsFromBases, azurePullRequestsOn, type PullRequestItem } from "../dev/prs.js";
import { resolveAzureAccess } from "./azureCmd.js";
import { todayLocalYmd, type argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

function remoteBase(repo: string): string | undefined {
  try {
    const r = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return webBaseFromRemote(r);
  } catch {
    return undefined;
  }
}

/** Commits + PRs del día (lo usan `dev day` y `linky day`). Devuelve undefined si la persona no activó dev. */
export async function devDay(dateYmd: string, dataDir?: string): Promise<{ commits: Commit[]; prs: PullRequestItem[]; errores: string[] } | undefined> {
  const cfg = await loadDevConfig(dataDir);
  if (!cfg?.repos.length) return undefined;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const errores: string[] = [];
  const commits = commitsOn({ repos: cfg.repos, authorEmails: cfg.authorEmails, dateYmd, timeZone: tz });
  const bases = cfg.repos.map(remoteBase).filter((b): b is string => Boolean(b));
  const prs: PullRequestItem[] = [];
  const reg = await loadAzureOrgs(dataDir);
  for (const o of reg.orgs) {
    const projects = azureProjectsFromBases(bases, o.organizationUrl);
    if (!projects.length) continue;
    try {
      const access = await resolveAzureAccess({ org: o.organizationUrl, dataDir });
      prs.push(...(await azurePullRequestsOn({ organizationUrl: access.organizationUrl, auth: access.auth, projects, dateYmd, timeZone: tz })));
    } catch (e) {
      errores.push(`${o.organizationUrl}: ${String((e as Error).message).split("\n")[0]}`);
    }
  }
  return { commits, prs, errores };
}

export async function runDevCommand(sub: string | undefined, a: Argv, dataDir?: string): Promise<void> {
  if (sub === "scan") {
    const root = a.arg("--root");
    if (!root) throw new Error('dev scan --root "<carpeta con tus repos>" [--email <correo>] [--days 60]');
    const emails = [...new Set([...defaultAuthorEmails(), ...a.all("--email")].map((e) => e.toLowerCase()))];
    if (!emails.length) throw new Error("Sin correo de autor: indica --email <tu correo de git>.");
    const days = Number(a.arg("--days") ?? 60);
    const all = await findRepos(root);
    const mine = all.filter((r) => hasRecentCommits(r, emails, days));
    const prev = await loadDevConfig(dataDir);
    const repos = [...new Set([...(prev?.repos ?? []), ...mine])];
    await saveDevConfig({ version: 1, repos, authorEmails: [...new Set([...(prev?.authorEmails ?? []), ...emails])] }, dataDir);
    console.log(JSON.stringify({ reposEncontrados: all.length, conTusCommits: mine, total: repos.length, correosAutor: emails }, null, 2));
    return;
  }
  if (sub === "repos") {
    const cfg = await loadDevConfig(dataDir);
    console.log(JSON.stringify({ repos: cfg?.repos ?? [], correosAutor: cfg?.authorEmails ?? [] }, null, 2));
    return;
  }
  if (sub === "remove") {
    const target = a.arg("--repo");
    if (!target) throw new Error('dev remove --repo "<nombre o ruta>"');
    const cfg = await loadDevConfig(dataDir);
    if (!cfg) throw new Error("dev no está activo.");
    const t = target.toLowerCase();
    const repos = cfg.repos.filter((r) => r.toLowerCase() !== t && r.split(/[\\/]/).pop()!.toLowerCase() !== t);
    await saveDevConfig({ ...cfg, repos }, dataDir);
    console.log(JSON.stringify({ quitados: cfg.repos.length - repos.length, repos }, null, 2));
    return;
  }
  if (sub === "day") {
    const dateYmd = a.arg("--date") ?? todayLocalYmd();
    const r = await devDay(dateYmd, dataDir);
    if (!r) {
      console.log(JSON.stringify({ activo: false, siguiente: 'Si la persona desarrolla: npm run linky -- dev scan --root "<carpeta>"' }, null, 2));
      return;
    }
    console.log(JSON.stringify({ fecha: dateYmd, ...r }, null, 2));
    return;
  }
  console.log(`linky dev <scan|day>   (opcional: solo si la persona desarrolla)
  scan --root "<carpeta>" [--email <correo>] [--days 60]   registra los repos locales con tus commits recientes
  repos                                                      repos registrados (mostrar a la persona)
  remove --repo "<nombre o ruta>"                            quitar un repo que no es de trabajo
  day  [--date YYYY-MM-DD]                                   commits (con enlace y Tasks AB#) y PRs de Azure del día`);
  if (sub) process.exitCode = 1;
}
