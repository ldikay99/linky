/**
 * Conectores de la persona (Azure, Google, Ripor, Google Chat, repositorios) sobre los comandos de Linky.
 * El estado sale de `doctor`; las credenciales nunca pasan por logs ni archivos: el token de Azure viaja
 * al CLI por la variable de un solo uso LINKY_AZURE_PAT_INPUT y termina cifrado (llavero o bóveda).
 */
import type { Connector, ConnectorsResponse, MeetingItem, ProfileForm } from "../../shared/protocol.js";
import { ORG_URL_RE, PAT_RE } from "../../shared/schemas.js";
import type { UserRow } from "../store/db.js";
import { cli, serializedFor, withTempJson, type Workspace } from "./workspace.js";

type Check = { area: string; ok: boolean; detail?: string; fix?: string };

const CACHE_MS = 90_000;
const cache = new Map<string, { at: number; value: ConnectorsResponse }>();

export const validOrgUrl = (v: string) => ORG_URL_RE.test(v.trim());
export const plausiblePat = (v: string) => PAT_RE.test(v.trim());

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

  async function logout(user: UserRow, ws: Workspace, which: "google" | "ripor") {
    const r = await serializedFor(user.id, () => cli(ws, [which, "logout"], { timeoutMs: 120_000 }));
    invalidate(user);
    return r;
  }

  async function disconnectAzure(user: UserRow, ws: Workspace, organizationUrl: string) {
    const r = await cli(ws, ["azure", "logout", "--org", organizationUrl.trim().replace(/\/$/, "")], { timeoutMs: 60_000 });
    invalidate(user);
    return r;
  }

  async function azureOrgs(ws: Workspace): Promise<{ primary: string | null; orgs: Array<{ organizationUrl: string; primary: boolean; status: string }> }> {
    const r = await cli(ws, ["azure", "orgs"], { timeoutMs: 60_000 });
    const j = r.json as { primary?: string | null; orgs?: Array<{ organizationUrl: string; primary?: boolean; status?: string }> } | null;
    return {
      primary: j?.primary ?? null,
      orgs: (j?.orgs ?? []).map((o) => ({ organizationUrl: o.organizationUrl, primary: Boolean(o.primary), status: String(o.status ?? "") })),
    };
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

  /**
   * Vencimiento real del token de la organización: primero se lee del correo que Azure envía al crearlo
   * (azure expires --from-mail) y luego se toma el registrado. null si no hay forma de saberlo.
   */
  async function knownExpiry(ws: Workspace, organizationUrl: string): Promise<string | null> {
    await cli(ws, ["azure", "expires", "--from-mail"], { timeoutMs: 120_000 }).catch(() => null);
    const key = (u: string) => u.trim().replace(/\/$/, "").toLowerCase();
    const r = await cli(ws, ["azure", "orgs"], { timeoutMs: 60_000 });
    const orgs = (r.json as { orgs?: Array<{ organizationUrl: string; expiresOn?: string }> } | null)?.orgs ?? [];
    const v = orgs.find((o) => key(o.organizationUrl) === key(organizationUrl))?.expiresOn;
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }

  async function saveProfile(user: UserRow, ws: Workspace, form: ProfileForm) {
    const known = await knownExpiry(ws, form.organizationUrl);
    // Solo si no hay correo ni fecha registrada: provisional a 90 días (lo recomendado al crear el token);
    // Linky lo corrige al llegar el correo o al fallar el token.
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
      patExpiresOn: known ?? in90,
      scopeChoice: "full_access",
      fullAccessAcknowledged: true,
      confirmDeviceTimeZone: true,
    };
    const r = await withTempJson(ws, answers, (file) => cli(ws, ["onboarding", "--answers", file], { timeoutMs: 180_000 }));
    invalidate(user);
    return r;
  }

  return { status, invalidate, connectAzure, disconnectAzure, azureOrgs, login, logout, meetings, classifyMeeting, devRepos, devScan, devRemove, saveProfile };
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export type Connectors = ReturnType<typeof createConnectors>;
