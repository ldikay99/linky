/**
 * HU (User Stories) donde la persona puede colgar sus Tasks: las abiertas de los sprints donde trabajó
 * últimamente, con cuántas Tasks suyas tienen. Para quien no crea HU (las crea el scrum/líder), esto es
 * la lista de padres válidos; Linky nunca crea una HU por su cuenta.
 */
import { azureAuthHeaders, type AzureAuth } from "./client.js";
import { azureReadJson } from "./http.js";

export type HuCandidate = { id: number; titulo: string; estado: string; sprint: string; proyecto: string; tusTasks: number; creadaPor: string; url: string };

export async function candidateParentHus(input: {
  organizationUrl: string;
  auth: Pick<AzureAuth, "pat" | "cookie">;
  sinceDays?: number;
  fetchImpl?: typeof fetch;
}): Promise<HuCandidate[]> {
  const f = input.fetchImpl ?? fetch;
  const org = input.organizationUrl;
  const h = { ...azureAuthHeaders(input.auth), accept: "application/json" };
  const since = new Date(Date.now() - (input.sinceDays ?? 45) * 86_400_000).toISOString().slice(0, 10);

  // 1) Tasks recientes de la persona → sus HU padre e iteraciones (sprints).
  const mine = await azureReadJson<{ workItems: Array<{ id: number }> }>(f, `${org}/_apis/wit/wiql?api-version=7.1&$top=200`, h, {
    query:
      "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Task' " +
      `AND ([System.AssignedTo] = @Me OR [System.CreatedBy] = @Me) AND [System.ChangedDate] >= '${since}'`,
  });
  if (!mine.workItems.length) return [];
  const tasks = await azureReadJson<{ value: Array<{ id: number; fields: Record<string, unknown> }> }>(f, `${org}/_apis/wit/workitemsbatch?api-version=7.1`, h, {
    ids: mine.workItems.slice(0, 200).map((w) => w.id),
    fields: ["System.Parent", "System.IterationPath"],
  });
  const myCount = new Map<number, number>();
  const iterations = new Set<string>();
  for (const t of tasks.value) {
    const p = Number(t.fields["System.Parent"]);
    if (Number.isInteger(p) && p > 0) myCount.set(p, (myCount.get(p) ?? 0) + 1);
    if (typeof t.fields["System.IterationPath"] === "string") iterations.add(String(t.fields["System.IterationPath"]));
  }

  // 2) HU de esos sprints + las HU padre de sus Tasks.
  const ids = new Set<number>(myCount.keys());
  if (iterations.size) {
    const list = [...iterations].map((i) => `'${i.replace(/'/g, "''")}'`).join(", ");
    const hus = await azureReadJson<{ workItems: Array<{ id: number }> }>(f, `${org}/_apis/wit/wiql?api-version=7.1&$top=200`, h, {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'User Story' AND [System.IterationPath] IN (${list})`,
    });
    for (const w of hus.workItems) ids.add(w.id);
  }
  if (!ids.size) return [];
  const details = await azureReadJson<{ value: Array<{ id: number; fields: Record<string, unknown> }> }>(f, `${org}/_apis/wit/workitemsbatch?api-version=7.1`, h, {
    ids: [...ids].slice(0, 200),
    fields: ["System.Title", "System.State", "System.IterationPath", "System.TeamProject", "System.CreatedBy", "System.WorkItemType"],
  });

  // 3) Solo HU abiertas (categoría del estado ≠ Completed/Removed), por proyecto.
  const projects = [...new Set(details.value.map((d) => String(d.fields["System.TeamProject"])))];
  const closed = new Map<string, Set<string>>();
  for (const p of projects) {
    const st = await azureReadJson<{ value: Array<{ name: string; category: string }> }>(
      f,
      `${org}/${encodeURIComponent(p)}/_apis/wit/workitemtypes/${encodeURIComponent("User Story")}/states?api-version=7.1`,
      h,
    ).catch(() => ({ value: [] as Array<{ name: string; category: string }> }));
    closed.set(p, new Set(st.value.filter((s) => /completed|removed/i.test(s.category)).map((s) => s.name)));
  }
  return details.value
    .filter((d) => d.fields["System.WorkItemType"] === "User Story")
    .filter((d) => !closed.get(String(d.fields["System.TeamProject"]))?.has(String(d.fields["System.State"])))
    .map((d) => {
      const proyecto = String(d.fields["System.TeamProject"]);
      const creator = d.fields["System.CreatedBy"] as { displayName?: string } | string | undefined;
      return {
        id: d.id,
        titulo: String(d.fields["System.Title"]),
        estado: String(d.fields["System.State"]),
        sprint: String(d.fields["System.IterationPath"]).split("\\").pop() ?? "",
        proyecto,
        tusTasks: myCount.get(d.id) ?? 0,
        creadaPor: typeof creator === "string" ? creator : creator?.displayName ?? "",
        url: `${org}/${encodeURIComponent(proyecto)}/_workitems/edit/${d.id}`,
      };
    })
    .sort((a, b) => b.tusTasks - a.tusTasks || b.id - a.id)
    .slice(0, 30);
}
