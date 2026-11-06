/**
 * `azure hours`: propuesta de horas reales (CompletedWork) por Task del día y registro con aprobación.
 * Preview con hash; apply con journal fail-closed, revalidación y control de revisión (test /rev).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readDayActivity } from "../azure/activity.js";
import { azureAuthHeaders, createHttpAzureClient } from "../azure/client.js";
import { parseFixedHours, proposeHours, type HoursProposal } from "../azure/hours.js";
import { loadAzureOrgs } from "../azure/orgs.js";
import { azureReadJson } from "../azure/http.js";
import { beginPending, getJournal, isUncertainError, markCompleted, markFailed, markUnknown } from "../apply/idempotency.js";
import { calendarDay, downloadCalendarExport } from "../calendar/export.js";
import { loadMeetingRules } from "../calendar/meetings.js";
import { holidayName } from "../ripor/holidays.js";
import { loadRiporProfile } from "../ripor/profileStore.js";
import { expectedHoursForDate, isWorkday } from "../ripor/schedule.js";
import { linkyDataDir } from "../security/paths.js";
import { resolveAzureAccess } from "./azureCmd.js";
import { devDay } from "./devCmd.js";
import { todayLocalYmd, type argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;
type HoursPreviewFile = { proposal: HoursProposal; organizationUrl: string; snapshotHash: string; createdAt: string };

const hashOf = (p: unknown) => createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 32);
const print = (obj: unknown) => console.log(JSON.stringify(obj, null, 2));

async function applyHours(a: Argv, previewPath: string, dataDir?: string): Promise<void> {
  if (!a.has("--approve")) throw new Error("azure hours --apply requiere --approve (aprobación explícita de la persona).");
  const file = JSON.parse(await readFile(a.arg("--preview") ?? previewPath, "utf8")) as HoursPreviewFile;
  if (hashOf(file.proposal) !== file.snapshotHash) throw new Error("El preview fue modificado: genera uno nuevo.");
  if (a.arg("--snapshot") !== file.snapshotHash) throw new Error("--snapshot no coincide con el preview aprobado.");
  const access = await resolveAzureAccess({ org: file.organizationUrl, dataDir });
  const results: Array<{ id: number; ok: boolean; detalle: string }> = [];
  for (const t of file.proposal.tareas) {
    const key = `hours::${file.proposal.dateYmd}::${t.id}::${t.nuevo}`;
    const prev = await getJournal(key, dataDir);
    if (prev?.status === "completed") {
      results.push({ id: t.id, ok: true, detalle: "ya aplicado (no se duplica)" });
      continue;
    }
    if (prev?.status === "pending" || prev?.status === "unknown") {
      results.push({ id: t.id, ok: false, detalle: `journal ${prev.status}: verificar la Task en Azure antes de repetir` });
      continue;
    }
    const client = createHttpAzureClient({ organizationUrl: access.organizationUrl, project: t.project, ...access.auth });
    // Revalidar: si la Task cambió desde el preview, no se pisa.
    const current = await client.getWorkItem(t.id);
    const completedNow = Number(current.fields["Microsoft.VSTS.Scheduling.CompletedWork"] ?? 0);
    if (Math.abs(completedNow - t.completadas) > 1e-9) {
      results.push({ id: t.id, ok: false, detalle: `cambió desde el preview (completadas ${completedNow} ≠ ${t.completadas}): repetir azure hours` });
      continue;
    }
    await beginPending({ key, action: "hours", previewSnapshotHash: file.snapshotHash, dataDir });
    try {
      await client.updateWorkItem(t.id, [
        { op: "test", path: "/rev", value: current.rev },
        { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.CompletedWork", value: t.nuevo },
      ]);
      await markCompleted(key, t.id, dataDir);
      results.push({ id: t.id, ok: true, detalle: `${t.completadas} → ${t.nuevo} h` });
    } catch (e) {
      const msg = String((e as Error).message).split("\n")[0];
      if (isUncertainError(e)) await markUnknown(key, msg, dataDir);
      else await markFailed(key, msg, dataDir);
      results.push({ id: t.id, ok: false, detalle: msg });
    }
  }
  print({ fecha: file.proposal.dateYmd, resultados: results });
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

export async function runAzureHours(a: Argv, dataDir?: string): Promise<void> {
  const previewPath = path.join(linkyDataDir(dataDir), "last-hours-preview.json");
  if (a.has("--apply")) return applyHours(a, previewPath, dataDir);

  const dateYmd = a.arg("--date") ?? todayLocalYmd();
  const access = await resolveAzureAccess({ org: a.arg("--org"), dataDir });
  const day = await readDayActivity({ organizationUrl: access.organizationUrl, auth: access.auth, dateYmd });
  const fixed = parseFixedHours(a.arg("--set"));
  const meetingsTaskId = a.arg("--meetings-task") ? Number(a.arg("--meetings-task")) : undefined;
  const ids = [
    ...new Set([
      ...day.items.filter((i) => /task|tarea|bug/i.test(i.type)).map((i) => i.id),
      ...Object.keys(fixed).map(Number),
      ...(meetingsTaskId ? [meetingsTaskId] : []),
    ]),
  ];

  // Señales de trabajo por Task: cambios de estado, comentarios y commits que la mencionan.
  const dev = await devDay(dateYmd, dataDir).catch(() => undefined);
  const commitRefs = new Map<number, number>();
  for (const c of dev?.commits ?? []) for (const w of c.workItems) commitRefs.set(w, (commitRefs.get(w) ?? 0) + 1);

  const headers = { ...azureAuthHeaders(access.auth), accept: "application/json" };
  const batch = ids.length
    ? await azureReadJson<{ value: Array<{ id: number; rev: number; fields: Record<string, unknown> }> }>(
        fetch,
        `${access.organizationUrl}/_apis/wit/workitemsbatch?api-version=7.1`,
        headers,
        { ids, fields: ["System.Title", "System.TeamProject", "Microsoft.VSTS.Scheduling.CompletedWork"] },
      )
    : { value: [] };
  const tasks = batch.value.map((w) => {
    const act = day.items.find((i) => i.id === w.id);
    return {
      id: w.id,
      title: String(w.fields["System.Title"] ?? ""),
      project: String(w.fields["System.TeamProject"] ?? ""),
      completed: Number(w.fields["Microsoft.VSTS.Scheduling.CompletedWork"] ?? 0),
      rev: w.rev,
      activity: (act?.stateChanges.length ?? 0) + (act?.comments.length ?? 0) + (commitRefs.get(w.id) ?? 0),
    };
  });

  // Jornada (lunes a viernes, sin festivos) y reuniones CONFIRMADAS por la persona.
  const rp = await loadRiporProfile(dataDir);
  const laborable = isWorkday(dateYmd) && !holidayName(dateYmd, rp?.extraHolidays);
  const jornada = laborable ? expectedHoursForDate(dateYmd, rp?.schedule) : 0;
  let reuniones = 0;
  const avisosExtra: string[] = [];
  if (!a.has("--no-calendar")) {
    try {
      const cal = calendarDay(await downloadCalendarExport({ dataDir }), dateYmd, { rules: await loadMeetingRules(dataDir) });
      reuniones = Math.round((cal.events.filter((e) => e.reunion === true).reduce((s, e) => s + e.minutes, 0) / 60) * 4) / 4;
      const pendientes = cal.events.filter((e) => e.reunion === null && !e.allDay);
      if (pendientes.length) avisosExtra.push(`${pendientes.length} evento(s) sin confirmar no cuentan como reunión: calendar meetings --date ${dateYmd}`);
    } catch (e) {
      avisosExtra.push(`Calendar no disponible (${String((e as Error).message).split("\n")[0]}); reuniones = 0.`);
    }
  }

  // La jornada es del día completo: sumar lo ya registrado en las OTRAS organizaciones conectadas.
  let otrasOrgs = 0;
  for (const o of (await loadAzureOrgs(dataDir)).orgs) {
    if (o.organizationUrl === access.organizationUrl) continue;
    try {
      const other = await resolveAzureAccess({ org: o.organizationUrl, dataDir });
      const h = (await readDayActivity({ organizationUrl: other.organizationUrl, auth: other.auth, dateYmd })).completedWorkHours;
      if (h > 0) {
        otrasOrgs += h;
        avisosExtra.push(`${h} h ya registradas ese día en ${o.organizationUrl} cuentan para la jornada.`);
      }
    } catch (e) {
      avisosExtra.push(`No se pudo leer ${o.organizationUrl} (${String((e as Error).message).split("\n")[0]}): sus horas no se descuentan; revisar con la persona.`);
    }
  }

  const proposal = proposeHours({ dateYmd, jornada, yaRegistradas: day.completedWorkHours + otrasOrgs, reunionesConfirmadas: reuniones, tasks, fixed, meetingsTaskId });
  proposal.avisos.push(...avisosExtra);
  if (!laborable) proposal.avisos.push("Día no laborable (fin de semana o festivo): jornada 0 h.");
  const file: HoursPreviewFile = { proposal, organizationUrl: access.organizationUrl, snapshotHash: hashOf(proposal), createdAt: new Date().toISOString() };
  await mkdir(path.dirname(previewPath), { recursive: true });
  await writeFile(previewPath, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  print({
    ...proposal,
    snapshotHash: file.snapshotHash,
    siguiente: proposal.tareas.length
      ? `Mostrar a la persona y, con su aprobación: npm run linky -- azure hours --apply --approve --snapshot ${file.snapshotHash}`
      : "Nada que registrar.",
  });
}
