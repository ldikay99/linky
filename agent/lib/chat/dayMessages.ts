/**
 * Mensajes de inicio y cierre de jornada a partir de Azure DevOps.
 * Los estados se clasifican por CATEGORÍA del proceso (Proposed/InProgress/Resolved/Completed),
 * no por nombre, para que sirva con cualquier proceso. El texto sale de plantillas que cada persona
 * ajusta a su área (`chat template`).
 */
import { readDayActivity } from "../azure/activity.js";
import { assertAzureAuthenticated, azureAuthHeaders, type AzureAuth } from "../azure/client.js";
import { validateOrganizationUrl } from "../security/orgUrl.js";

export type ChatTemplates = { inicio: string; cierre: string; item: string; vacio: string };

export const DEFAULT_CHAT_TEMPLATES: ChatTemplates = {
  inicio: "Buenos días 👋 Hoy ({fecha}) trabajaré en:\n{tareas}",
  cierre: "Cierre {fecha} ✅\nEntregado:\n{entregadas}\nEn curso:\n{en_curso}",
  item: "• #{id} {titulo}",
  vacio: "—",
};

export type TaskLine = { id: number; title: string; state: string; category: string; project: string; url: string };

type Fetch = typeof fetch;

async function getJson<T>(doFetch: Fetch, url: string, headers: Record<string, string>, body?: unknown): Promise<T> {
  const res = await doFetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { ...headers, "content-type": "application/json" } : headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  assertAzureAuthenticated(res);
  if (!res.ok) throw new Error(`Azure ${new URL(url).pathname}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Categoría de cada estado de Task por proyecto (cacheada por llamada). */
async function stateCategories(doFetch: Fetch, org: string, headers: Record<string, string>, projects: string[]) {
  const out = new Map<string, Map<string, string>>();
  for (const project of projects) {
    const data = await getJson<{ value: Array<{ name: string; category: string }> }>(
      doFetch,
      `${org}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/Task/states?api-version=7.1`,
      headers,
    ).catch(() => ({ value: [] }));
    out.set(project, new Map(data.value.map((s) => [s.name, s.category])));
  }
  return out;
}

/** Tasks asignadas a la persona que siguen abiertas (Proposed / InProgress), recientes. */
export async function myOpenTasks(input: {
  organizationUrl: string;
  auth: Pick<AzureAuth, "pat" | "cookie">;
  sinceDays?: number;
  fetchImpl?: Fetch;
}): Promise<TaskLine[]> {
  const org = validateOrganizationUrl(input.organizationUrl).organizationUrl;
  const doFetch = input.fetchImpl ?? fetch;
  const headers = { ...azureAuthHeaders(input.auth), accept: "application/json" };
  const since = new Date(Date.now() - (input.sinceDays ?? 45) * 86_400_000).toISOString().slice(0, 10);
  const wiql = await getJson<{ workItems: Array<{ id: number }> }>(
    doFetch,
    `${org}/_apis/wit/wiql?api-version=7.1&$top=200`,
    headers,
    {
      query:
        "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.WorkItemType] = 'Task' " +
        `AND [System.ChangedDate] >= '${since}' ORDER BY [System.ChangedDate] DESC`,
    },
  );
  if (!wiql.workItems.length) return [];
  const batch = await getJson<{ value: Array<{ id: number; fields: Record<string, unknown> }> }>(
    doFetch,
    `${org}/_apis/wit/workitemsbatch?api-version=7.1`,
    headers,
    { ids: wiql.workItems.slice(0, 200).map((w) => w.id), fields: ["System.Title", "System.State", "System.TeamProject"] },
  );
  const projects = [...new Set(batch.value.map((w) => String(w.fields["System.TeamProject"])))];
  const cats = await stateCategories(doFetch, org, headers, projects);
  const lines = batch.value.map((w) => {
    const project = String(w.fields["System.TeamProject"]);
    const state = String(w.fields["System.State"]);
    return {
      id: w.id,
      title: String(w.fields["System.Title"]),
      state,
      category: cats.get(project)?.get(state) ?? "",
      project,
      url: `${org}/${encodeURIComponent(project)}/_workitems/edit/${w.id}`,
    };
  });
  const open = lines.filter((l) => l.category === "InProgress" || l.category === "Proposed");
  // En curso primero, luego planeación.
  return [...open.filter((l) => l.category === "InProgress"), ...open.filter((l) => l.category === "Proposed")];
}

/** Lo entregado/cerrado hoy por la persona (cambio de estado propio hoy a Resolved/Completed). */
export async function deliveredOn(input: {
  organizationUrl: string;
  auth: Pick<AzureAuth, "pat" | "cookie">;
  dateYmd: string;
  fetchImpl?: Fetch;
}): Promise<TaskLine[]> {
  const org = validateOrganizationUrl(input.organizationUrl).organizationUrl;
  const doFetch = input.fetchImpl ?? fetch;
  const headers = { ...azureAuthHeaders(input.auth), accept: "application/json" };
  const day = await readDayActivity({ organizationUrl: org, auth: input.auth, dateYmd: input.dateYmd, fetchImpl: input.fetchImpl });
  const changed = day.items.filter((i) => i.type === "Task" && i.stateChanges.length);
  const cats = await stateCategories(doFetch, org, headers, [...new Set(changed.map((i) => i.project))]);
  return changed
    .map((i) => ({ id: i.id, title: i.title, state: i.state, category: cats.get(i.project)?.get(i.state) ?? "", project: i.project, url: i.url }))
    .filter((l) => l.category === "Resolved" || l.category === "Completed");
}

function fmtDate(dateYmd: string): string {
  const [, m, d] = dateYmd.split("-");
  return `${d}/${m}`;
}

type DayData = { dateYmd: string; tareas?: TaskLine[]; entregadas?: TaskLine[]; en_curso?: TaskLine[] };

function renderOnce(
  kind: "inicio" | "cierre",
  data: DayData,
  t: ChatTemplates,
  limits: { title: number; items: number },
): string {
  const cut = (s: string) => (s.length > limits.title ? s.slice(0, limits.title - 1).trimEnd() + "…" : s);
  const list = (items?: TaskLine[]) => {
    if (!items?.length) return t.vacio;
    const shown = items.slice(0, limits.items);
    const lines = shown.map((i) =>
      t.item.replace("{id}", String(i.id)).replace("{titulo}", cut(i.title)).replace("{estado}", i.state).replace("{url}", i.url),
    );
    if (items.length > shown.length) lines.push(`… y ${items.length - shown.length} más`);
    return lines.join("\n");
  };
  return (kind === "inicio" ? t.inicio : t.cierre)
    .replace("{fecha}", fmtDate(data.dateYmd))
    .replace("{tareas}", list(data.tareas))
    .replace("{entregadas}", list(data.entregadas))
    .replace("{en_curso}", list(data.en_curso))
    .trim();
}

/**
 * Renderiza con la plantilla de la persona. Si pasa de `maxChars`, acorta títulos y luego
 * agrupa ("… y N más"), conservando siempre el número de cada Task para rastrearla.
 */
export function renderDayMessage(
  kind: "inicio" | "cierre",
  data: DayData,
  templates: Partial<ChatTemplates> = {},
  maxChars = Number.POSITIVE_INFINITY,
): string {
  const t = { ...DEFAULT_CHAT_TEMPLATES, ...templates };
  let last = "";
  for (const items of [Infinity, 8, 5, 3, 1]) {
    for (const title of [Infinity, 60, 45, 30]) {
      last = renderOnce(kind, data, t, { title, items });
      if (last.length <= maxChars) return last;
    }
  }
  return last;
}
