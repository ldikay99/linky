/**
 * Adaptador HTTP para Ripor: implementa RiporUiAdapter con las peticiones del formulario web.
 * Las políticas (8.5/8 h, suma del día, preview+hash, aprobación, journal) siguen en el núcleo
 * (`applyRiporMutation`); este adaptador solo traduce labels → IDs y verifica tras mutar.
 */
import type { RiporUiAdapter } from "../../browser/adapter.js";
import { defaultBrowserCapabilities } from "../../browser/capabilities.js";
import type { RiporProfile } from "../types.js";
import { RiporSessionExpiredError, type RiporHttpClient } from "./client.js";
import { catalogFromPageData, extractReports, type RiporCatalog, type RiporHttpReport } from "./reports.js";

const EPS = 1e-9;

export type ResolvedFormIds = {
  projectId: number;
  analyticAccountId: number;
  code: string;
  taskId: number;
  transportValue: string;
};

/** Traduce labels del draft a IDs del formulario usando SOLO el perfil (nunca IDs de ejemplo). */
export function resolveFormIds(
  profile: RiporProfile,
  labels: { project?: string; task?: string; transport?: string },
): { ok: true; ids: ResolvedFormIds } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const area = profile.areaProject;
  if (!area || area.label !== labels.project) {
    errors.push(`Proyecto "${labels.project ?? ""}" no coincide con el proyecto de área configurado.`);
  } else if (area.projectId === undefined || area.analyticAccountId === undefined || !area.code) {
    errors.push("Proyecto de área sin IDs HTTP (projectId/analyticAccountId/code). Ejecuta: ripor catalog y ripor setup.");
  }

  const tasks = profile.taskOptions ?? [];
  const task = tasks.find((t) => t.label === labels.task);
  const taskId = task?.uiValue !== undefined ? Number(task.uiValue) : Number.NaN;
  if (!task) errors.push(`Tarea "${labels.task ?? ""}" no está en el catálogo del perfil.`);
  else if (!Number.isInteger(taskId)) errors.push(`Tarea "${task.label}" sin id (uiValue) en el perfil.`);

  const transports = [...(profile.transportOptions ?? []), ...(profile.defaultTransport ? [profile.defaultTransport] : [])];
  const tr = transports.find((t) => t.label === labels.transport);
  if (!tr) errors.push(`Transporte "${labels.transport ?? ""}" no está en el catálogo del perfil.`);
  else if (!tr.formValue) errors.push(`Transporte "${tr.label}" sin valor de formulario.`);
  else if (!tr.verifiedFromUi) {
    errors.push(
      `Transporte "${tr.label}" (${tr.formValue}) no verificado contra Ripor. Regístralo una vez en la web y ejecuta ripor catalog --from-date <fecha> para verificarlo.`,
    );
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    ids: {
      projectId: area!.projectId!,
      analyticAccountId: area!.analyticAccountId!,
      code: area!.code!,
      taskId,
      transportValue: tr!.formValue!,
    },
  };
}

export function buildCreateForm(f: {
  date: string;
  hours: number;
  notes: string;
  evidence: string;
  ids: ResolvedFormIds;
}): Array<[string, string]> {
  // Mismo orden/campos que envía la web (notes va duplicado en el original).
  return [
    ["notes", f.notes],
    ["date", f.date],
    ["project_id", String(f.ids.projectId)],
    ["code", f.ids.code],
    ["hours", String(f.hours)],
    ["analytic_account_id", String(f.ids.analyticAccountId)],
    ["reports", "[]"],
    ["currentMonth", JSON.stringify(f.date.slice(0, 7))],
    ["totalhours", String(f.hours)],
    ["report_task_id", String(f.ids.taskId)],
    ["notes", f.notes],
    ["evidencia", f.evidence],
    ["medio_transporte", f.ids.transportValue],
  ];
}

/**
 * Copia del reporte con los valores editados (el formulario web envía el objeto ligado al form;
 * Ripor toma campos como la evidencia desde `report`, no solo de los campos sueltos).
 */
export function editedReportRaw(
  raw: Record<string, unknown>,
  v: { hours: number; notes: string; evidence: string; taskId: number; transportValue: string },
): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(raw)) as Record<string, any>;
  const h = copy.hr_contractor_reported_hours;
  if (h && typeof h === "object") {
    Object.assign(h, { hours: v.hours, report_description: v.notes, evidencia: v.evidence, evidence: v.evidence });
    if ("report_task_id" in h) h.report_task_id = v.taskId;
    if ("task_id" in h) h.task_id = v.taskId;
  }
  const l = copy.account_analytic_line;
  if (l && typeof l === "object") {
    Object.assign(l, { name: v.notes, unit_amount: v.hours, report_description: v.notes, evidencia: v.evidence, evidence: v.evidence });
    if ("task_id" in l) l.task_id = v.taskId;
  }
  const t = copy.linktic_report_task;
  if (t && typeof t === "object" && "hours" in t) t.hours = v.hours;
  copy.evidencia = v.evidence;
  copy.medio_transporte = v.transportValue;
  return copy;
}

export function buildUpdateForm(f: {
  report: RiporHttpReport;
  sameDay: RiporHttpReport[];
  monthReportDates: string[];
  totalHoursPerUser?: number;
  hours: number;
  notes: string;
  evidence: string;
  ids: ResolvedFormIds;
}): Array<[string, string]> {
  const date = f.report.dateYmd;
  const dates = f.monthReportDates.length ? f.monthReportDates : [date];
  const edited = editedReportRaw(f.report.raw, {
    hours: f.hours,
    notes: f.notes,
    evidence: f.evidence,
    taskId: f.ids.taskId,
    transportValue: f.ids.transportValue,
  });
  const form: Array<[string, string]> = [
    ["notes", f.notes],
    ["id", f.report.id],
    ["date", date],
    ["hours", String(f.hours)],
    ["code", f.ids.code],
    ["reports", JSON.stringify(dates.map((d) => ({ date: d })))],
    ["report", JSON.stringify(edited)],
    ["reportDate", JSON.stringify(f.sameDay.map((r) => (r.id === f.report.id ? edited : r.raw)))],
  ];
  if (f.totalHoursPerUser !== undefined) form.push(["totalhoursPerUser", String(f.totalHoursPerUser)]);
  form.push(
    ["currentMonth", JSON.stringify(date.slice(0, 7))],
    ["totalhours", String(f.hours)],
    ["oldTasksHours", "null"],
    ["dayBloked", "false"],
    ["report_task_id", String(f.ids.taskId)],
    ["evidencia", f.evidence],
    ["medio_transporte", f.ids.transportValue],
  );
  return form;
}

export function createHttpRiporAdapter(input: { client: RiporHttpClient; profile: RiporProfile }): RiporUiAdapter & {
  catalog(): Promise<RiporCatalog>;
  reportsForDate(dateYmd: string): Promise<RiporHttpReport[]>;
} {
  const { client, profile } = input;
  let catalogCache: RiporCatalog | undefined;

  async function catalog(): Promise<RiporCatalog> {
    catalogCache ??= catalogFromPageData(await client.getPageData());
    return catalogCache;
  }

  async function reportsForDate(dateYmd: string): Promise<RiporHttpReport[]> {
    return extractReports(await client.getReports(dateYmd)).filter((r) => r.dateYmd === dateYmd);
  }

  const uncertain = (msg: string) => ({ ok: false, message: `uncertain: ${msg}. Reconciliar con ripor list antes de repetir.` });

  return {
    kind: "http",
    capabilities: defaultBrowserCapabilities({
      headedLoginSupported: true,
      notes: [
        "Modo HTTP: mismas peticiones que el formulario web con la sesión del usuario (keyring). Navegador solo para login.",
        "No se guardan cookies en repo/perfil/journal.",
      ],
    }),
    catalog,
    reportsForDate,

    async ensureSession() {
      try {
        await client.getPageData();
        return { status: "authenticated", profileDir: "", message: "Sesión Ripor válida (HTTP)." };
      } catch (e) {
        if (e instanceof RiporSessionExpiredError) return { status: "expired", profileDir: "", message: e.message };
        throw e;
      }
    },
    async listAreaProjects() {
      return (await catalog()).areaProjects.map((p) => p.label);
    },
    async listTaskLabels() {
      const c = await catalog();
      return c.tasks.length ? c.tasks.map((t) => t.label) : (profile.taskOptions ?? []).map((t) => t.label);
    },
    async listTransportLabels() {
      return (profile.transportOptions ?? []).map((t) => t.label);
    },
    async listReportsForDate(dateYmd) {
      return (await reportsForDate(dateYmd)).map((r) => ({
        id: r.id,
        dateYmd: r.dateYmd,
        hours: r.hours,
        summary: r.description,
      }));
    },

    async applyUiAction(action) {
      const fields = action.fields ?? {};
      let before: RiporHttpReport[];
      try {
        before = await reportsForDate(action.dateYmd);
      } catch (e) {
        // Antes del POST: nada se envió → fallo definitivo, no incierto.
        return { ok: false, message: `No se pudo leer el día antes de mutar: ${(e as Error).message}` };
      }
      // Sesión vencida = SvelteKit redirige antes de ejecutar la acción → no se aplicó.
      const post: RiporHttpClient["postAction"] = async (a, form) => {
        try {
          return await client.postAction(a, form);
        } catch (e) {
          if (e instanceof RiporSessionExpiredError) {
            return { ok: false, type: "failure", status: 401, message: e.message };
          }
          throw e;
        }
      };

      if (action.op === "delete") {
        const target = before.find((r) => r.id === action.reportId);
        if (!target) return { ok: false, message: `Reporte ${action.reportId} no existe el ${action.dateYmd}.` };
        if (target.userId === undefined) return { ok: false, message: "Reporte sin user_id (personal_id) — no se borra." };
        const res = await post("delete", [
          ["id", target.id],
          ["personal_id", String(target.userId)],
        ]);
        if (!res.ok) return res.type === "failure" || res.type === "error" ? { ok: false, message: res.message } : uncertain(res.message);
        try {
          const after = await reportsForDate(action.dateYmd);
          if (after.some((r) => r.id === target.id)) return uncertain("el reporte sigue apareciendo tras borrar");
        } catch (e) {
          return uncertain(`no se pudo verificar: ${(e as Error).message}`);
        }
        return { ok: true, message: `Ripor delete OK (${target.id})`, reportId: target.id };
      }

      const resolved = resolveFormIds(profile, {
        project: fields.project_label,
        task: fields.task_label,
        transport: fields.medio_transporte,
      });
      if (!resolved.ok) return { ok: false, message: resolved.errors.join(" ") };
      const hours = Number(fields.hours);
      const notes = fields.notes ?? "";
      const evidence = fields.evidencia ?? "";

      let res;
      if (action.op === "create") {
        res = await post(
          "create",
          buildCreateForm({ date: action.dateYmd, hours, notes, evidence, ids: resolved.ids }),
        );
      } else {
        const target = before.find((r) => r.id === action.reportId);
        if (!target) return { ok: false, message: `Reporte ${action.reportId} no existe el ${action.dateYmd}.` };
        let cat: RiporCatalog | undefined;
        try {
          cat = await catalog();
        } catch {
          cat = undefined;
        }
        res = await post(
          "update",
          buildUpdateForm({
            report: target,
            sameDay: before,
            monthReportDates: cat?.monthReportDates ?? [],
            totalHoursPerUser: cat?.totalHoursPerUser,
            hours,
            notes,
            evidence,
            ids: resolved.ids,
          }),
        );
      }
      if (!res.ok) return res.type === "failure" || res.type === "error" ? { ok: false, message: res.message } : uncertain(res.message);

      // Verificación posterior (reconciliación automática).
      let after: RiporHttpReport[];
      try {
        after = await reportsForDate(action.dateYmd);
      } catch (e) {
        return uncertain(`acción aceptada pero no se pudo verificar: ${(e as Error).message}`);
      }
      if (action.op === "create") {
        const created = after.filter((r) => !before.some((b) => b.id === r.id));
        if (created.length !== 1 || Math.abs(created[0].hours - hours) > EPS) {
          return uncertain(`se esperaba 1 reporte nuevo de ${hours}h y hay ${created.length}`);
        }
        if ((created[0].evidence ?? "") !== evidence || (created[0].description ?? "") !== notes) {
          return uncertain("el reporte creado no coincide en descripción/evidencia");
        }
        return { ok: true, message: `Ripor create OK (${created[0].id})`, reportId: created[0].id };
      }
      const row = after.find((r) => r.id === action.reportId);
      const mismatch = !row
        ? ["reporte ausente"]
        : [
            Math.abs(row.hours - hours) > EPS ? "horas" : "",
            (row.description ?? "") !== notes ? "descripción" : "",
            (row.evidence ?? "") !== evidence ? "evidencia" : "",
            row.transport !== undefined && row.transport !== resolved.ids.transportValue ? "transporte" : "",
          ].filter(Boolean);
      if (!row || mismatch.length) return uncertain(`el reporte no refleja los cambios (${mismatch.join(", ")})`);
      return { ok: true, message: `Ripor update OK (${row.id})`, reportId: row.id };
    },
  };
}
