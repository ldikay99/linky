/**
 * Sugerencia de reporte Ripor a partir de la actividad real en Azure (punto de partida para la IA):
 * descripción breve, evidencia (HU padre más frecuente) y horas sustentadas. Nunca inventa trabajo:
 * si Azure no sustenta la jornada, lo marca para preguntar.
 */
import { azureReadJson } from "../azure/http.js";
import type { DayActivityReport } from "../azure/activity.js";
import { azureAuthHeaders, type AzureAuth } from "../azure/client.js";
import { RIPOR_DESCRIPTION_MAX_CHARS, RIPOR_DESCRIPTION_MIN_CHARS } from "./policy.js";

export type RiporSuggestion = {
  notes: string;
  evidence?: { url: string; title: string; reason: string };
  sustainedHours: number;
  expectedHours: number;
  warnings: string[];
};

/** "Revisar X - FastReportCRM" → grupo "FastReportCRM", texto "revisar X". */
function splitSuffix(title: string): { group?: string; text: string } {
  const m = /^(.*?)\s+-\s+([^-]{2,40})$/.exec(title.trim());
  const text = (m ? m[1] : title).trim();
  return { group: m?.[2]?.trim(), text: text.charAt(0).toLowerCase() + text.slice(1) };
}

export function buildRiporNotes(activity: DayActivityReport, maxChars = RIPOR_DESCRIPTION_MAX_CHARS): string {
  // Prioridad: entregadas/creadas ese día, luego el resto tocado. Solo Tasks/Bugs (trabajo concreto).
  const items = activity.items
    .filter((i) => /task|tarea|bug/i.test(i.type))
    .sort((a, b) => Number(b.stateChanges.length > 0 || b.createdToday) - Number(a.stateChanges.length > 0 || a.createdToday));
  const groups = new Map<string, string[]>();
  for (const i of items) {
    const { group, text } = splitSuffix(i.title);
    const key = group ?? i.project;
    groups.set(key, [...(groups.get(key) ?? []), text]);
  }
  const render = (perGroup: number) =>
    [...groups.entries()]
      .map(([g, texts]) => {
        const shown = texts.slice(0, perGroup);
        const more = texts.length - shown.length;
        return `${g}: ${shown.join("; ")}${more > 0 ? ` y ${more} tarea(s) más` : ""}.`;
      })
      .join(" ");
  for (const perGroup of [Infinity, 6, 4, 3, 2, 1]) {
    const text = render(perGroup);
    if (text.length <= maxChars) return text;
  }
  return render(1).slice(0, maxChars - 1).trimEnd() + "…";
}

/** HU padre más frecuente entre las Tasks del día (evidencia que cubre todo el trabajo). */
export async function parentEvidence(input: {
  organizationUrl: string;
  auth: Pick<AzureAuth, "pat" | "cookie">;
  activity: DayActivityReport;
  fetchImpl?: typeof fetch;
}): Promise<RiporSuggestion["evidence"]> {
  const tasks = input.activity.items.filter((i) => /task|tarea|bug/i.test(i.type));
  if (!tasks.length) return undefined;
  const doFetch = input.fetchImpl ?? fetch;
  const headers = { ...azureAuthHeaders(input.auth), accept: "application/json" };
  const get = <T>(url: string) => azureReadJson<T>(doFetch, url, headers);
  const ids = tasks.map((t) => t.id).slice(0, 200).join(",");
  const parents = await get<{ value: Array<{ id: number; fields: Record<string, unknown> }> }>(
    `${input.organizationUrl}/_apis/wit/workitems?ids=${ids}&fields=System.Parent&api-version=7.1`,
  );
  const counts = new Map<number, number>();
  for (const v of parents.value) {
    const p = Number(v.fields["System.Parent"]);
    if (Number.isInteger(p) && p > 0) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) {
    const t = tasks[0];
    return { url: t.url, title: t.title, reason: "Task principal del día (sin HU padre)" };
  }
  const hu = await get<{ fields: Record<string, unknown> }>(
    `${input.organizationUrl}/_apis/wit/workitems/${best[0]}?fields=System.Title,System.TeamProject&api-version=7.1`,
  );
  const project = String(hu.fields["System.TeamProject"]);
  return {
    url: `${input.organizationUrl}/${encodeURIComponent(project)}/_workitems/edit/${best[0]}`,
    title: String(hu.fields["System.Title"]),
    reason: `HU padre de ${best[1]} de ${tasks.length} tarea(s) del día`,
  };
}

export function suggestionWarnings(s: Omit<RiporSuggestion, "warnings">): string[] {
  const w: string[] = [];
  if (s.notes.length < RIPOR_DESCRIPTION_MIN_CHARS) w.push(`Descripción corta (${s.notes.length}); completar con la persona (mínimo ${RIPOR_DESCRIPTION_MIN_CHARS}).`);
  if (!s.evidence) w.push("Sin evidencia en Azure ese día: pedir un enlace a la persona.");
  if (s.sustainedHours < s.expectedHours) {
    w.push(
      `Azure sustenta ${s.sustainedHours} h de ${s.expectedHours} h. No inventar: preguntar a la persona qué más hizo ` +
        "(reuniones de calendar day, soporte, etc.) o si es una jornada menor explícita.",
    );
  }
  return w;
}
