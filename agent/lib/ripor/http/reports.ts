/**
 * Normalización de reportes Ripor (getReport) y catálogo desde __data.json.
 * Defensivo: campos ausentes → NaN/undefined (las políticas fallan cerrado, nunca 0).
 */

export type RiporHttpReport = {
  id: string;
  dateYmd: string;
  hours: number;
  description?: string;
  /** Evidencia vigente: Ripor la escribe en `evidence` al crear y al editar. */
  evidence?: string;
  /** Columna `evidencia` (la que muestra la web): solo se fija al CREAR; editar no la cambia. */
  evidenceDisplayed?: string;
  taskId?: number;
  taskLabel?: string;
  projectId?: number;
  analyticAccountId?: number;
  code?: string;
  projectName?: string;
  transport?: string;
  userId?: number;
  /** Objeto tal cual lo devolvió Ripor (lo exige ?/update en `report`/`reportDate`). */
  raw: Record<string, unknown>;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

export function normalizeReport(raw: Obj): RiporHttpReport | null {
  const h = isObj(raw.hr_contractor_reported_hours) ? raw.hr_contractor_reported_hours : {};
  const l = isObj(raw.account_analytic_line) ? raw.account_analytic_line : {};
  const t = isObj(raw.linktic_report_task) ? raw.linktic_report_task : {};
  const a = isObj(raw.account_analytic_account) ? raw.account_analytic_account : {};
  const id = num(raw.id) ?? num(h.id) ?? num(l.id);
  const date = str(h.date) ?? str(l.date) ?? str(raw.date);
  if (id === undefined || !date) return null;
  return {
    id: String(id),
    dateYmd: date.slice(0, 10),
    hours: num(h.hours) ?? num(l.unit_amount) ?? num(raw.hours) ?? Number.NaN,
    description: str(h.report_description) ?? str(l.report_description) ?? str(l.name) ?? str(raw.notes),
    evidence: str(h.evidence) ?? str(l.evidence) ?? str(raw.evidencia) ?? str(h.evidencia),
    evidenceDisplayed: str(raw.evidencia) ?? str(h.evidencia) ?? str(l.evidencia),
    taskId: num(t.id) ?? num(h.report_task_id) ?? num(h.task_id),
    taskLabel: str(t.name),
    projectId: num(raw.project_id) ?? num(l.project_id),
    analyticAccountId: num(a.id) ?? num(l.account_id),
    code: str(a.code) ?? str(h.account_analytic_code),
    projectName: str(a.name),
    transport: str(raw.medio_transporte),
    userId: num(h.user_id) ?? num(l.user_id),
    raw,
  };
}

/** getReport puede devolver un arreglo o un objeto que lo contiene. */
export function extractReports(payload: unknown): RiporHttpReport[] {
  let list: unknown[] | undefined;
  if (Array.isArray(payload)) list = payload;
  else if (isObj(payload)) {
    // Ripor real: { success, result: [...] }
    if (payload.success === false) throw new Error("getReport: success=false (no se asume día vacío).");
    for (const k of ["result", "reports", "reportDate", "data", "report"]) {
      const v = payload[k];
      if (Array.isArray(v)) {
        list = v;
        break;
      }
      if (isObj(v) && normalizeReport(v)) {
        list = [v];
        break;
      }
    }
    if (!list && normalizeReport(payload)) list = [payload];
  }
  if (!list) throw new Error("getReport: formato no reconocido (no se asume día vacío).");
  const out: RiporHttpReport[] = [];
  for (const item of list) {
    if (!isObj(item)) continue;
    const r = normalizeReport(item);
    if (!r) throw new Error("getReport: reporte sin id/fecha (no se asume día vacío).");
    out.push(r);
  }
  return out;
}

export type RiporCatalog = {
  areaProjects: Array<{ label: string; projectId?: number; analyticAccountId?: number; code?: string }>;
  tasks: Array<{ label: string; id: number }>;
  transports: string[];
  monthReportDates: string[];
  totalHoursPerUser?: number;
  topLevelKeys: string[];
};

/** Recorre los nodos decodificados de __data.json buscando catálogos (heurístico, se revisa con el usuario). */
export function catalogFromPageData(nodes: unknown[]): RiporCatalog {
  const cat: RiporCatalog = {
    areaProjects: [],
    tasks: [],
    transports: [],
    monthReportDates: [],
    topLevelKeys: [],
  };
  const seen = new Set<unknown>();
  const projectKeys = new Set<string>();
  const taskKeys = new Set<number>();

  function visit(v: unknown, key: string, depth: number) {
    if (depth > 12 || v === null || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      if (key === "reports") {
        for (const r of v) if (isObj(r) && str(r.date)) cat.monthReportDates.push(String(r.date).slice(0, 10));
      }
      for (const x of v) visit(x, key, depth + 1);
      return;
    }
    const o = v as Obj;
    if (key === "totalhoursPerUser" || num(o.totalhoursPerUser) !== undefined) {
      cat.totalHoursPerUser ??= num(o.totalhoursPerUser);
    }
    const name = str(o.name);
    const id = num(o.id);
    // Cuenta analítica (ej. {id, code, name, plan_id}) o proyecto con referencia a cuenta analítica.
    if (name && id !== undefined && (str(o.code) || num(o.analytic_account_id) !== undefined || num(o.account_id) !== undefined)) {
      const isTask = num(o.task_group_id) !== undefined;
      if (!isTask) {
        const entry = {
          label: name,
          projectId: num(o.project_id) ?? (str(o.code) ? undefined : id),
          analyticAccountId: num(o.analytic_account_id) ?? num(o.account_id) ?? (str(o.code) ? id : undefined),
          code: str(o.code),
        };
        const k = `${entry.label}|${entry.code ?? ""}`;
        if (!projectKeys.has(k)) {
          projectKeys.add(k);
          cat.areaProjects.push(entry);
        }
      }
    }
    if (name && id !== undefined && num(o.task_group_id) !== undefined && !taskKeys.has(id)) {
      taskKeys.add(id);
      cat.tasks.push({ label: name, id });
    }
    const mt = str(o.medio_transporte);
    if (mt && !cat.transports.includes(mt)) cat.transports.push(mt);
    for (const [k, child] of Object.entries(o)) visit(child, k, depth + 1);
  }

  for (const n of nodes) {
    if (isObj(n)) cat.topLevelKeys.push(...Object.keys(n));
    visit(n, "", 0);
  }
  cat.monthReportDates = [...new Set(cat.monthReportDates)].sort();
  return cat;
}
