/**
 * Conectores de la persona (Azure, Google, Ripor, Google Chat, repositorios) sobre los comandos de Linky.
 * El estado sale de `doctor`; las credenciales nunca pasan por logs ni archivos: el token de Azure viaja
 * al CLI por la variable de un solo uso LINKY_AZURE_PAT_INPUT y termina cifrado (llavero o bóveda).
 */
import type { Connector, ConnectorsResponse, MeetingItem, ProfileForm } from "../../shared/protocol.js";
import type { UserRow } from "../store/db.js";
import { cli, serializedFor, withTempJson, type Workspace } from "./workspace.js";

type Check = { area: string; ok: boolean; detail?: string; fix?: string };

const CACHE_MS = 90_000;
const cache = new Map<string, { at: number; value: ConnectorsResponse }>();

export const validOrgUrl = (v: string) => /^https:\/\/(dev\.azure\.com\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}|[A-Za-z0-9][A-Za-z0-9-]{0,63}\.visualstudio\.com)\/?$/.test(v.trim());
export const plausiblePat = (v: string) => /^[A-Za-z0-9._~+/=-]{20,400}$/.test(v.trim());

function connector(id: Connector["id"], name: string, description: string, checks: Check[], optional: boolean): Connector {
  if (!checks.length) return { id, name, description, state: optional ? "optional" : "disconnected", details: [], optional };
  const bad = checks.filter((c) => !c.ok);
  return {
    id,
    name,
    description,
    optional,
    state: bad.length === 0 ? "connected" : bad.length === checks.length && !optional ? "disconnected" : "attention",
    details: checks.map((c) => `${c.area.replace(/^(azure|ripor) ?/, "") || c.area}: ${c.detail ?? ""}`.trim()),
    fix: bad.find((c) => c.fix)?.fix,
  };
}

export function mapDoctor(checks: Check[]): ConnectorsResponse {
  const by = (re: RegExp) => checks.filter((c) => re.test(c.area));
  const known = /^(azure|google|ripor|chat|dev)/;
  return {
    checkedAt: Date.now(),
    connectors: [
      connector("azure", "Azure DevOps", "HU, Tasks y horas en tus organizaciones.", by(/^azure/), false),
      connector("google", "Google", "Calendar, Gmail y el acceso a Ripor con tu cuenta.", by(/^google/), false),
      connector("ripor", "Ripor", "Reporte diario de horas.", by(/^ripor/), false),
      connector("chat", "Google Chat", "Mensajes de inicio y cierre de jornada (opcional).", by(/^chat/), true),
      connector("dev", "Repositorios", "Commits y PR como evidencia, si desarrollas (opcional).", by(/^dev/), true),
    ],
    problems: checks.filter((c) => !c.ok && !known.test(c.area)).map((c) => `${c.area}: ${c.detail ?? ""}${c.fix ? ` — ${c.fix}` : ""}`),
  };
}

export function createConnectors() {
  async function status(user: UserRow, ws: Workspace, force = false): Promise<ConnectorsResponse> {
    const hit = cache.get(user.id);
    if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const r = await serializedFor(user.id, () => cli(ws, ["doctor"], { timeoutMs: 180_000 }));
    const checks = ((r.json as { checks?: Check[] } | null)?.checks ?? []).filter((c) => c && typeof c.area === "string");
    const value = checks.length ? mapDoctor(checks) : { ...mapDoctor([]), problems: [r.ok ? "Sin datos de doctor." : r.text.split("\n")[0]] };
    cache.set(user.id, { at: Date.now(), value });
    return value;
  }

  const invalidate = (user: UserRow) => cache.delete(user.id);

  async function connectAzure(user: UserRow, ws: Workspace, input: { organizationUrl: string; pat: string; primary: boolean }) {
    const args = ["azure", "connect", "--org", input.organizationUrl.trim().replace(/\/$/, "")];
    if (input.primary) args.push("--primary");
    const r = await cli(ws, args, { timeoutMs: 180_000, env: { LINKY_AZURE_PAT_INPUT: input.pat.trim() } });
    invalidate(user);
    return r;
  }

  async function login(user: UserRow, ws: Workspace, which: "google" | "ripor" | "chat") {
    const r = await serializedFor(user.id, () => cli(ws, [which, "login"], { timeoutMs: 600_000 }));
    invalidate(user);
    return r;
  }

  async function meetings(user: UserRow, ws: Workspace, date?: string): Promise<{ items: MeetingItem[]; error?: string }> {
    const r = await serializedFor(user.id, () => cli(ws, ["calendar", "meetings", ...(date ? ["--date", date] : [])], { timeoutMs: 180_000 }));
    if (!r.ok || !r.json) return { items: [], error: r.text.split("\n")[0] };
    const j = r.json as Record<string, unknown>;
    const titles = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String((x as { title?: string; titulo?: string }).title ?? (x as { titulo?: string }).titulo ?? ""))).filter(Boolean) : []);
    const items: MeetingItem[] = [
      ...titles(j.sinConfirmar ?? j.pendientes ?? j.unconfirmed).map((title) => ({ title, status: "pending" as const })),
      ...titles(j.confirmadas ?? j.confirmed).map((title) => ({ title, status: "confirmed" as const })),
      ...titles(j.ignoradas ?? j.ignored).map((title) => ({ title, status: "ignored" as const })),
    ];
    return { items };
  }

  async function classifyMeeting(ws: Workspace, title: string, action: "confirm" | "ignore") {
    return cli(ws, ["calendar", action, "--title", title], { timeoutMs: 60_000 });
  }

  async function devRepos(ws: Workspace) {
    return cli(ws, ["dev", "repos"], { timeoutMs: 60_000 });
  }

  async function devScan(user: UserRow, ws: Workspace, root: string) {
    const r = await cli(ws, ["dev", "scan", "--root", root], { timeoutMs: 180_000 });
    invalidate(user);
    return r;
  }

  async function devRemove(user: UserRow, ws: Workspace, name: string) {
    const r = await cli(ws, ["dev", "remove", "--repo", name], { timeoutMs: 60_000 });
    invalidate(user);
    return r;
  }

  async function saveProfile(user: UserRow, ws: Workspace, form: ProfileForm) {
    const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const answers = {
      organizationUrl: form.organizationUrl,
      project: form.project,
      occupation: form.occupation,
      projectContext: form.projectContext,
      assignedDisplayName: form.assignedDisplayName,
      responsibleTag: form.responsibleTag || undefined,
      huCreation: form.huCreation,
      taskDelivery: "same_user",
      taskClose: form.taskClose,
      huClose: form.huClose,
      mondayToThursday: form.mondayToThursday,
      friday: form.friday,
      lunchStart: form.lunchStart,
      lunchEnd: form.lunchEnd,
      lunchMinutes: minutes(form.lunchEnd) - minutes(form.lunchStart),
      confirmScheduleInterpretation: true,
      // Provisional: Linky lo corrige con el correo de Azure (azure expires --from-mail) o al fallar el token.
      patExpiresOn: in90,
      scopeChoice: "full_access",
      fullAccessAcknowledged: true,
      confirmDeviceTimeZone: true,
    };
    const r = await withTempJson(ws, answers, (file) => cli(ws, ["onboarding", "--answers", file], { timeoutMs: 180_000 }));
    if (r.ok) await cli(ws, ["azure", "expires", "--from-mail"], { timeoutMs: 120_000 }).catch(() => null);
    invalidate(user);
    return r;
  }

  return { status, invalidate, connectAzure, login, meetings, classifyMeeting, devRepos, devScan, devRemove, saveProfile };
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export type Connectors = ReturnType<typeof createConnectors>;
