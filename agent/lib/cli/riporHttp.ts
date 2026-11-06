/**
 * Comandos Ripor en modo HTTP: login (una vez), sesión, catálogo, listado, reconcile
 * y construcción de draft por flags. Las mutaciones siguen pasando por preview+apply del núcleo.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RiporUiAdapter } from "../browser/adapter.js";
import { createMockRiporUiAdapter } from "../browser/adapter.js";
import { linkyDataDir } from "../security/paths.js";
import { loadOrEmptyRiporProfile } from "../ripor/profileStore.js";
import { expectedHoursForDate } from "../ripor/schedule.js";
import { workTimeZone } from "../planning/schedule.js";
import { loadRiporJournal, reconcileRiporJournalEntry } from "../ripor/journal.js";
import { readHiddenPrompt } from "../security/hiddenInput.js";
import type { RiporSetupInput } from "../ripor/setup.js";
import type {
  RiporAreaProject,
  RiporCoverageProof,
  RiporDraftFields,
  RiporProfile,
  RiporTaskOption,
  RiporTransportOption,
} from "../ripor/types.js";
import {
  clearRiporSession,
  describeRiporSession,
  extractAuthCookiesFromPaste,
  KNOWN_RIPOR_TRANSPORTS,
  loadRiporSession,
  openRiporHttp,
  resolveRiporSecretStore,
  saveRiporSession,
  RiporSessionExpiredError,
  type RiporCatalog,
} from "../ripor/http/index.js";

export type RiporDraftPayload = {
  op?: "create" | "update" | "delete";
  dateYmd: string;
  draft?: RiporDraftFields;
  reportId?: string;
  activitiesCoverFullDay?: boolean;
  sustainedActivityHours?: number;
  coverageProof?: RiporCoverageProof;
};

type Argv = { arg(flag: string): string | undefined; has(flag: string): boolean; all(flag: string): string[] };

export function argvHelpers(argv = process.argv): Argv {
  return {
    arg(flag) {
      const i = argv.indexOf(flag);
      return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
    },
    has: (flag) => argv.includes(flag),
    all(flag) {
      const out: string[] = [];
      argv.forEach((a, i) => {
        if (a === flag && argv[i + 1]) out.push(argv[i + 1]);
      });
      return out;
    },
  };
}

/** Fecha local del dispositivo (zona/reloj del equipo). */
/** "Hoy" en la zona de la jornada (Colombia por defecto), no en la del equipo. */
export function todayLocalYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: workTimeZone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function futureDateBlocker(dateYmd: string, now = new Date()): string | undefined {
  const today = todayLocalYmd(now);
  return dateYmd > today ? `Fecha futura ${dateYmd} (hoy en este dispositivo: ${today}): no se reportan horas por adelantado.` : undefined;
}

export async function riporAdapterFor(profile: RiporProfile, mock: boolean): Promise<RiporUiAdapter> {
  if (mock) return createMockRiporUiAdapter();
  return (await openRiporHttpFresh(profile)).adapter;
}

/**
 * Abre Ripor por HTTP y, si la sesión venció, la renueva SIN ventana con la sesión de Google
 * del perfil compartido de Linky; si eso no alcanza, pide `ripor login`.
 */
export async function openRiporHttpFresh(profile: RiporProfile) {
  const store = await resolveRiporSecretStore();
  try {
    const h = await openRiporHttp(profile, { store });
    await h.client.getPageData();
    return h;
  } catch (e) {
    const expired = e instanceof RiporSessionExpiredError || /No hay sesión Ripor/.test(String((e as Error).message));
    if (!expired || process.env.LINKY_RIPOR_COOKIE) throw e;
    process.stderr.write("Sesión de Ripor vencida: renovando sin ventana con tu sesión de Google…\n");
    const { loginRiporWithBrowser } = await import("../ripor/http/login.js");
    const cookies = await loginRiporWithBrowser({ headlessOnly: true });
    await saveRiporSession({ cookies, savedAt: new Date().toISOString(), source: "refresh" }, store);
    return openRiporHttp(profile, { store });
  }
}

/** Completa labels faltantes del draft con los defaults del perfil (proyecto área, tarea, transporte). */
export function fillDraftDefaults(draft: RiporDraftFields, profile: RiporProfile): RiporDraftFields {
  return {
    ...draft,
    areaProjectLabel: draft.areaProjectLabel || profile.areaProject?.label || "",
    taskLabel: draft.taskLabel || profile.defaultTaskLabel,
    transportLabel: draft.transportLabel || profile.defaultTransport?.label || "",
    transportIsDailyOverride:
      draft.transportIsDailyOverride ?? (Boolean(draft.transportLabel) && draft.transportLabel !== profile.defaultTransport?.label),
  };
}

/**
 * Draft por flags (sin JSON) para que la IA sea rápida:
 *   --date --notes --evidence (repetible) --hours --sustained --under-hours "motivo" --transporte --task --update <id>
 */
export function draftPayloadFromFlags(a: Argv, profile: RiporProfile, now = new Date()): RiporDraftPayload {
  const dateYmd = a.arg("--date") ?? todayLocalYmd(now);
  const expected = expectedHoursForDate(dateYmd, profile.schedule);
  const hours = a.arg("--hours") !== undefined ? Number(a.arg("--hours")) : expected;
  const underReason = a.arg("--under-hours");
  if (underReason !== undefined && a.arg("--hours") === undefined) {
    throw new Error("--under-hours requiere --hours explícito (petición limitada a fecha + cantidad).");
  }
  const nonWorkday = a.has("--trabajo-extra");
  if (nonWorkday && a.arg("--hours") === undefined) {
    throw new Error("--trabajo-extra (fin de semana o festivo trabajado) requiere --hours con las horas que la persona indicó.");
  }
  const transport = a.arg("--transporte");
  const draft = fillDraftDefaults(
    {
      dateYmd,
      areaProjectLabel: "",
      taskLabel: a.arg("--task") ?? "",
      hours,
      description: a.arg("--notes") ?? "",
      evidenceUrls: a.all("--evidence"),
      transportLabel: transport ?? "",
      transportIsDailyOverride: Boolean(transport) && transport !== profile.defaultTransport?.label,
      explicitUnderHoursRequest:
        underReason !== undefined ? { dateYmd, hours, reason: underReason || undefined } : undefined,
      nonWorkdayConfirmed: nonWorkday || undefined,
    },
    profile,
  );
  const sustained = a.arg("--sustained");
  return {
    op: a.arg("--update") ? "update" : "create",
    dateYmd,
    draft,
    reportId: a.arg("--update"),
    coverageProof:
      sustained !== undefined
        ? { sustainedActivityHours: Number(sustained), coversDraftDedication: true, source: "azure_confirmed" }
        : undefined,
  };
}

function print(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

export async function cmdRiporLogin(a: Argv) {
  const store = await resolveRiporSecretStore();
  let cookies;
  let source: "browser" | "paste";
  if (a.has("--paste")) {
    const raw = await readHiddenPrompt(
      "Pega el valor del header 'cookie' de una petición a ripor.co (una sola línea) y Enter. No se mostrará: ",
      { allowEnvFallback: true },
    );
    cookies = extractAuthCookiesFromPaste(raw);
    source = "paste";
  } else {
    const { loginRiporWithBrowser } = await import("../ripor/http/login.js");
    cookies = await loginRiporWithBrowser({ channel: a.arg("--channel") });
    source = "browser";
  }
  const session = { cookies, savedAt: new Date().toISOString(), source };
  await saveRiporSession(session, store);
  print({ ok: true, backend: store.backend, session: describeRiporSession(session) });
}

export async function cmdRiporLogout() {
  const store = await resolveRiporSecretStore();
  await clearRiporSession(store);
  print({ ok: true, message: "Sesión Ripor eliminada del almacén local. Para invalidarla del todo, cierra sesión en ripor.co." });
}

export async function cmdRiporSession(a: Argv, dataDir?: string) {
  const store = await resolveRiporSecretStore();
  const session = await loadRiporSession(store);
  const status = describeRiporSession(session);
  let live: string | undefined;
  if (session && a.has("--check")) {
    const profile = await loadOrEmptyRiporProfile(dataDir);
    const { adapter } = await openRiporHttpFresh(profile);
    live = (await adapter.ensureSession({ allowHeadedLogin: false })).status;
  }
  print({ backend: store.backend, ...status, live: live ?? "(usa --check para validar contra Ripor)" });
}

function mergeTransports(observed: string[]): RiporTransportOption[] {
  const out = KNOWN_RIPOR_TRANSPORTS.map((t) => ({ ...t, verifiedFromUi: t.verifiedFromUi || observed.includes(t.formValue!) }));
  for (const v of observed) {
    if (!out.some((t) => t.formValue === v)) out.push({ label: v, formValue: v, verifiedFromUi: true });
  }
  return out;
}

export async function cmdRiporCatalog(a: Argv, dataDir?: string) {
  const profile = await loadOrEmptyRiporProfile(dataDir);
  const { adapter } = await openRiporHttpFresh(profile);
  const warnings: string[] = [];
  let catalog: RiporCatalog | undefined;
  try {
    catalog = await adapter.catalog();
  } catch (e) {
    warnings.push(`No se pudo leer __data.json: ${(e as Error).message}`);
  }

  const areaProjects: RiporAreaProject[] = (catalog?.areaProjects ?? []).map((p) => ({
    label: p.label,
    projectId: p.projectId,
    analyticAccountId: p.analyticAccountId,
    code: p.code,
    verifiedFromUi: false,
  }));
  const tasks: RiporTaskOption[] = (catalog?.tasks ?? []).map((t) => ({ label: t.label, uiValue: String(t.id), verifiedFromUi: true }));
  const observedTransports = [...(catalog?.transports ?? [])];
  let chosenProject = "";
  let chosenTransport = "";

  const fromDate = a.arg("--from-date");
  if (fromDate) {
    // Reporte real ya registrado en la web → IDs exactos y verificados.
    const reports = await adapter.reportsForDate(fromDate);
    if (!reports.length) warnings.push(`No hay reportes el ${fromDate}; elige una fecha que ya tenga uno.`);
    for (const r of reports) {
      if (r.projectName && r.projectId !== undefined && r.analyticAccountId !== undefined && r.code) {
        const existing = areaProjects.find((p) => p.label === r.projectName);
        const entry = { label: r.projectName, projectId: r.projectId, analyticAccountId: r.analyticAccountId, code: r.code, verifiedFromUi: true };
        if (existing) Object.assign(existing, entry);
        else areaProjects.push(entry);
        chosenProject ||= r.projectName;
      }
      if (r.taskLabel && r.taskId !== undefined && !tasks.some((t) => t.uiValue === String(r.taskId))) {
        tasks.push({ label: r.taskLabel, uiValue: String(r.taskId), verifiedFromUi: true });
      }
      if (r.transport) {
        observedTransports.push(r.transport);
        chosenTransport ||= r.transport;
      }
    }
  }

  const transports = mergeTransports(observedTransports);
  const chosenTransportLabel = transports.find((t) => t.formValue === chosenTransport)?.label ?? "";
  const answers: RiporSetupInput = {
    uiObserved: true,
    uiAreaProjects: areaProjects,
    chosenAreaProjectLabel: areaProjects.length === 1 ? areaProjects[0].label : chosenProject,
    uiTaskOptions: tasks,
    chosenTaskLabel: tasks.find((t) => /tarea personalizada/i.test(t.label))?.label ?? tasks[0]?.label,
    uiTransportOptions: transports,
    chosenTransportLabel,
    azureProjectHints: profile.azureProjectHints,
  };

  const dir = linkyDataDir(dataDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const answersPath = path.join(dir, "ripor-setup-answers.json");
  await writeFile(answersPath, JSON.stringify(answers, null, 2), { encoding: "utf8", mode: 0o600 });
  const rawOut = a.arg("--raw-out");
  if (rawOut) {
    const { client } = await openRiporHttp(profile);
    // La página incluye la sesión (tokens): se redacta antes de escribir.
    const redacted = JSON.stringify(
      await client.getPageData(),
      (k, v) => (/^(session|access_token|refresh_token|provider_token|provider_refresh_token|token)$/i.test(k) ? "[REDACTADO]" : v),
      2,
    );
    await writeFile(rawOut, redacted, { encoding: "utf8", mode: 0o600 });
    warnings.push(`Datos crudos en ${rawOut}: contienen datos personales; no los subas al repo.`);
  }

  if (!answers.chosenAreaProjectLabel) warnings.push("Elige el proyecto de ÁREA (no el de Azure) y pásalo con: ripor setup --answers <file> --project \"<label>\".");
  if (!answers.chosenTransportLabel) warnings.push("Elige el transporte por defecto con --transporte \"<label>\".");
  if (!fromDate) warnings.push("Tip: ripor catalog --from-date <YYYY-MM-DD de un reporte ya hecho> da IDs exactos y verificados.");
  print({
    answersPath,
    areaProjects: areaProjects.map((p) => `${p.label}${p.code ? ` [${p.code}]` : ""}${p.verifiedFromUi ? " ✓" : ""}`),
    tasks: tasks.map((t) => t.label),
    transports: transports.map((t) => `${t.label}${t.verifiedFromUi ? " ✓" : " (no verificado)"}`),
    chosen: { project: answers.chosenAreaProjectLabel, task: answers.chosenTaskLabel, transport: answers.chosenTransportLabel },
    topLevelKeys: catalog?.topLevelKeys ?? [],
    warnings,
    next: `npm run linky -- ripor setup --answers "${answersPath}"`,
  });
}

export async function cmdRiporList(a: Argv, dataDir?: string) {
  const profile = await loadOrEmptyRiporProfile(dataDir);
  const { adapter } = await openRiporHttpFresh(profile);
  const dateYmd = a.arg("--date") ?? todayLocalYmd();
  const reports = await adapter.reportsForDate(dateYmd);
  const total = reports.reduce((s, r) => s + r.hours, 0);
  print({
    dateYmd,
    expectedHours: expectedHoursForDate(dateYmd, profile.schedule),
    totalHours: total,
    reports: reports.map(({ raw: _raw, userId: _u, ...r }) => r),
    warnings: reports
      .filter((r) => r.evidenceDisplayed && r.evidence && r.evidenceDisplayed !== r.evidence)
      .map(
        (r) =>
          `Reporte ${r.id}: la web muestra la evidencia de creación (${r.evidenceDisplayed}); la editada (${r.evidence}) solo queda en 'evidence'. Para cambiar la visible: borrar y crear (con aprobación).`,
      ),
  });
}

export async function cmdRiporReconcile(a: Argv, dataDir?: string) {
  const id = a.arg("--id");
  const status = a.arg("--status") as "ok" | "failed" | undefined;
  if (id) {
    if (status !== "ok" && status !== "failed") throw new Error("reconcile --id requiere --status ok|failed (tras revisar con ripor list).");
    const row = await reconcileRiporJournalEntry(id, status, `reconciliado manualmente (${status})`, dataDir);
    if (!row) throw new Error(`Entrada de journal ${id} no encontrada.`);
    print({ ok: true, entry: row });
    return;
  }
  const journal = await loadRiporJournal(dataDir);
  const open = journal.filter((e) => e.status === "pending" || e.status === "unknown");
  const profile = await loadOrEmptyRiporProfile(dataDir);
  const live: Record<string, unknown> = {};
  if (open.length && !a.has("--mock")) {
    const { adapter } = await openRiporHttpFresh(profile);
    for (const d of new Set(open.map((e) => e.dateYmd))) {
      live[d] = (await adapter.reportsForDate(d)).map((r) => ({ id: r.id, hours: r.hours, description: r.description }));
    }
  }
  print({
    open,
    liveReportsByDate: live,
    next: open.length
      ? "Compara y marca cada entrada: ripor reconcile --id <journalId> --status ok|failed"
      : "Sin entradas abiertas.",
  });
}

/** Sugerencia de reporte Ripor desde la actividad Azure del día (organización principal o --org). */
export async function riporSuggestion(a: Argv, profile: RiporProfile, dataDir?: string) {
  const { resolveAzureAccess } = await import("./azureCmd.js");
  const { readDayActivity } = await import("../azure/activity.js");
  const { buildRiporNotes, parentEvidence, suggestionWarnings } = await import("../ripor/suggest.js");
  const dateYmd = a.arg("--date") ?? todayLocalYmd();
  const access = await resolveAzureAccess({ org: a.arg("--org"), dataDir });
  const activity = await readDayActivity({ organizationUrl: access.organizationUrl, auth: access.auth, dateYmd });
  const expectedHours = expectedHoursForDate(dateYmd, profile.schedule);
  const base = {
    notes: buildRiporNotes(activity, profile.descriptionMaxChars),
    evidence: await parentEvidence({ organizationUrl: access.organizationUrl, auth: access.auth, activity }),
    sustainedHours: activity.completedWorkHours,
    expectedHours,
  };
  // Para quien desarrolla: los PRs del día son evidencia alternativa (más concreta que la HU).
  const { devDay } = await import("./devCmd.js");
  const dev = await devDay(dateYmd, dataDir).catch(() => undefined);
  const evidenciasAlternativas = dev?.prs.map((p) => ({ url: p.url, titulo: p.title, motivo: `PR ${p.event} ese día` })) ?? [];
  return { dateYmd, ...base, evidenciasAlternativas, warnings: suggestionWarnings(base) };
}

/** `ripor preview --auto`: completa notas/evidencia/horas sustentadas con la sugerencia (lo explícito gana). */
export async function autoDraftPayload(a: Argv, profile: RiporProfile, dataDir?: string): Promise<RiporDraftPayload & { warnings: string[] }> {
  const s = await riporSuggestion(a, profile, dataDir);
  const argv = [...process.argv];
  if (!a.arg("--date")) argv.push("--date", s.dateYmd);
  if (!a.arg("--notes")) argv.push("--notes", s.notes);
  if (!a.all("--evidence").length && s.evidence) argv.push("--evidence", s.evidence.url);
  if (!a.arg("--sustained")) argv.push("--sustained", String(Math.min(s.sustainedHours, s.expectedHours)));
  return { ...draftPayloadFromFlags(argvHelpers(argv), profile), warnings: s.warnings };
}

/** `ripor month`: días laborables del mes que faltan o están incompletos (festivos y fines de semana no se exigen). */
export async function cmdRiporMonth(a: Argv, dataDir?: string) {
  const profile = await loadOrEmptyRiporProfile(dataDir);
  if (!profile.setupComplete) throw new Error("Falta ripor setup: npm run linky -- ripor login → ripor catalog --from-date <día ya reportado> → ripor setup");
  const { classifyMonth, monthDays } = await import("../ripor/month.js");
  const today = todayLocalYmd();
  const monthYm = a.arg("--month") ?? today.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthYm)) throw new Error("--month YYYY-MM");
  const { adapter } = await openRiporHttpFresh(profile);
  const days = monthDays(monthYm).filter((d) => d <= today);
  const reportedByDay: Record<string, number> = {};
  for (let i = 0; i < days.length; i += 6) {
    const chunk = days.slice(i, i + 6);
    const res = await Promise.all(chunk.map((d) => adapter.reportsForDate(d)));
    chunk.forEach((d, k) => {
      reportedByDay[d] = res[k].reduce((s, r) => s + (Number.isFinite(r.hours) ? r.hours : 0), 0);
    });
  }
  const month = classifyMonth({ monthYm, todayYmd: today, reportedByDay, schedule: profile.schedule, extraHolidays: profile.extraHolidays });

  let sugerencias: Array<Record<string, unknown>> | undefined;
  if (a.has("--suggest") && month.totales.diasPendientes.length) {
    sugerencias = [];
    for (const d of month.totales.diasPendientes) {
      try {
        const s = await riporSuggestion(argvHelpers(["", "", "--date", d]), profile, dataDir);
        sugerencias.push({ fecha: d, descripcion: s.notes, evidencia: s.evidence?.url, horasAzure: s.sustainedHours, avisos: s.warnings });
      } catch (e) {
        sugerencias.push({ fecha: d, error: String((e as Error).message).split("\n")[0] });
      }
    }
  }
  print({
    mes: monthYm,
    resumen: month.totales,
    dias: month.dias.filter((d) => d.estado !== "futuro"),
    sugerencias,
    siguientes: month.totales.diasPendientes.map((d) => `npm run linky -- ripor preview --auto --date ${d}`),
  });
}
