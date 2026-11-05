/**
 * Actividad real de la persona en un día (todos los proyectos de la organización):
 * work items que ELLA cambió ese día, con cambios de estado, horas completadas y comentarios.
 * Fuente para la descripción breve de Ripor. Solo lectura.
 */
import { validateOrganizationUrl } from "../security/orgUrl.js";
import { assertAzureAuthenticated, azureAuthHeaders, type AzureAuth } from "./client.js";

export type DayActivityItem = {
  id: number;
  title: string;
  type: string;
  project: string;
  state: string;
  url: string;
  createdToday: boolean;
  stateChanges: string[];
  completedWorkDelta: number;
  comments: string[];
  changedAt: string[];
};

export type DayActivityReport = {
  dateYmd: string;
  timeZone: string;
  user: string;
  items: DayActivityItem[];
  completedWorkHours: number;
};

type Update = {
  id: number;
  rev?: number;
  revisedBy?: { id?: string; displayName?: string; uniqueName?: string };
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
};

function localYmd(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readDayActivity(input: {
  organizationUrl: string;
  auth: Pick<AzureAuth, "pat" | "cookie">;
  dateYmd: string;
  timeZone?: string;
  fetchImpl?: typeof fetch;
}): Promise<DayActivityReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateYmd)) throw new Error(`Fecha inválida: ${input.dateYmd}`);
  const org = validateOrganizationUrl(input.organizationUrl).organizationUrl;
  const timeZone = input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const doFetch = input.fetchImpl ?? fetch;
  const headers = { ...azureAuthHeaders(input.auth), accept: "application/json" };

  async function get<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await doFetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body ? { ...headers, "content-type": "application/json" } : headers,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    assertAzureAuthenticated(res);
    if (!res.ok) throw new Error(`Azure ${new URL(url).pathname}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  const conn = await get<{ authenticatedUser: { id: string; providerDisplayName?: string } }>(
    `${org}/_apis/connectionData`,
  );
  const me = conn.authenticatedUser;

  // Margen de un día antes por diferencias de zona horaria; se filtra exacto después.
  const since = new Date(Date.parse(`${input.dateYmd}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const wiql = await get<{ workItems: Array<{ id: number }> }>(`${org}/_apis/wit/wiql?api-version=7.1&$top=200`, {
    method: "POST",
    body: {
      query:
        "SELECT [System.Id] FROM WorkItems WHERE " +
        "([System.AssignedTo] = @Me OR [System.ChangedBy] EVER @Me OR [System.CreatedBy] = @Me) " +
        `AND [System.ChangedDate] >= '${since}' ORDER BY [System.ChangedDate] DESC`,
    },
  });
  const ids = wiql.workItems.map((w) => w.id);
  if (!ids.length) {
    return { dateYmd: input.dateYmd, timeZone, user: me.providerDisplayName ?? "", items: [], completedWorkHours: 0 };
  }

  const batch = await get<{ value: Array<{ id: number; fields: Record<string, unknown> }> }>(
    `${org}/_apis/wit/workitemsbatch?api-version=7.1`,
    {
      method: "POST",
      body: {
        ids: ids.slice(0, 200),
        fields: ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.TeamProject"],
      },
    },
  );

  const items: DayActivityItem[] = [];
  for (const wi of batch.value) {
    const updates = await get<{ value: Update[] }>(`${org}/_apis/wit/workItems/${wi.id}/updates?api-version=7.1`);
    const mine = updates.value.filter((u) => {
      const changed = u.fields?.["System.ChangedDate"]?.newValue;
      return u.revisedBy?.id === me.id && typeof changed === "string" && localYmd(changed, timeZone) === input.dateYmd;
    });
    if (!mine.length) continue;
    const project = String(wi.fields["System.TeamProject"] ?? "");
    const item: DayActivityItem = {
      id: wi.id,
      title: String(wi.fields["System.Title"] ?? ""),
      type: String(wi.fields["System.WorkItemType"] ?? ""),
      project,
      state: String(wi.fields["System.State"] ?? ""),
      url: `${org}/${encodeURIComponent(project)}/_workitems/edit/${wi.id}`,
      createdToday: mine.some((u) => u.rev === 1),
      stateChanges: [],
      completedWorkDelta: 0,
      comments: [],
      changedAt: [],
    };
    for (const u of mine) {
      const f = u.fields ?? {};
      item.changedAt.push(String(f["System.ChangedDate"]?.newValue));
      const st = f["System.State"];
      if (st?.newValue !== undefined) item.stateChanges.push(`${st.oldValue ?? "∅"} → ${st.newValue}`);
      const cw = f["Microsoft.VSTS.Scheduling.CompletedWork"];
      if (cw?.newValue !== undefined) item.completedWorkDelta += Number(cw.newValue ?? 0) - Number(cw.oldValue ?? 0);
      const hist = f["System.History"]?.newValue;
      if (typeof hist === "string" && hist.trim()) item.comments.push(stripHtml(hist).slice(0, 300));
    }
    items.push(item);
  }

  return {
    dateYmd: input.dateYmd,
    timeZone,
    user: me.providerDisplayName ?? "",
    items,
    completedWorkHours: Math.round(items.reduce((s, i) => s + i.completedWorkDelta, 0) * 100) / 100,
  };
}
