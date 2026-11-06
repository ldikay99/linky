/**
 * `linky day`: todo lo del día en UNA llamada para la IA (rápido y con menos errores):
 * jornada (laborable, horas Ripor, festivos), actividad Azure, Tasks abiertas, reuniones,
 * reportes Ripor existentes, borradores de inicio/cierre y siguientes pasos sugeridos.
 * Solo lectura. Cada sección falla por separado (`errores`) sin tumbar las demás.
 */
import { readDayActivity, type DayActivityReport } from "../azure/activity.js";
import { loadAzureOrgs } from "../azure/orgs.js";
import { calendarDay, downloadCalendarExport } from "../calendar/export.js";
import { gmailDay, type MailItem } from "../mail/gmail.js";
import { loadChatConfig } from "../chat/config.js";
import { deliveredOn, myOpenTasks, renderDayMessage, type TaskLine } from "../chat/dayMessages.js";
import { loadRiporProfile } from "../ripor/profileStore.js";
import { expectedHoursForDate, isWorkday } from "../ripor/schedule.js";
import { resolveAzureAccess } from "./azureCmd.js";
import { futureDateBlocker, openRiporHttpFresh, todayLocalYmd, type argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

const short = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200);

export async function runDay(a: Argv, dataDir?: string): Promise<void> {
  const dateYmd = a.arg("--date") ?? todayLocalYmd();
  const errores: Record<string, string> = {};
  const [riporProfile, chatCfg, reg] = await Promise.all([loadRiporProfile(dataDir), loadChatConfig(dataDir), loadAzureOrgs(dataDir)]);
  const orgs = a.has("--all") ? reg.orgs.map((o) => o.organizationUrl) : [a.arg("--org") ?? reg.primary];

  // Azure, Ripor y Calendar en paralelo: el total ≈ la parte más lenta.
  const azureJob = (async () => {
    const reports: Array<DayActivityReport & { organizationUrl: string }> = [];
    let open: TaskLine[] = [];
    let delivered: TaskLine[] = [];
    for (const org of orgs) {
      try {
        const access = await resolveAzureAccess({ org, dataDir });
        const day = await readDayActivity({ organizationUrl: access.organizationUrl, auth: access.auth, dateYmd });
        reports.push({ organizationUrl: access.organizationUrl, ...day });
        if (access.organizationUrl === (reg.primary ?? access.organizationUrl) || orgs.length === 1) {
          [open, delivered] = await Promise.all([
            myOpenTasks({ organizationUrl: access.organizationUrl, auth: access.auth }),
            deliveredOn({ organizationUrl: access.organizationUrl, auth: access.auth, dateYmd, day }),
          ]);
        }
      } catch (e) {
        errores[`azure ${org ?? ""}`.trim()] = short(e);
      }
    }
    return { reports, open, delivered };
  })();

  const riporJob = (async () => {
    if (!riporProfile?.setupComplete) {
      errores.ripor = "Sin setup de Ripor (ripor catalog + ripor setup).";
      return undefined;
    }
    try {
      const { adapter } = await openRiporHttpFresh(riporProfile);
      return await adapter.reportsForDate(dateYmd);
    } catch (e) {
      errores.ripor = short(e);
      return undefined;
    }
  })();

  // Calendar y correos comparten el perfil de navegador: van en secuencia dentro de este trabajo.
  let mail: MailItem[] | undefined;
  const calendarJob = (async () => {
    let cal: ReturnType<typeof calendarDay> | undefined;
    if (!a.has("--no-calendar")) {
      try {
        cal = calendarDay(await downloadCalendarExport({ dataDir }), dateYmd);
      } catch (e) {
        errores.calendar = short(e);
      }
    }
    if (a.has("--mail")) {
      try {
        mail = await gmailDay({ dateYmd, box: "sent", dataDir });
      } catch (e) {
        errores.correos = short(e);
      }
    }
    return cal;
  })();

  const [azure, riporReports, calendar] = await Promise.all([azureJob, riporJob, calendarJob]);

  const expected = expectedHoursForDate(dateYmd, riporProfile?.schedule);
  const reported = riporReports?.reduce((s, r) => s + (Number.isFinite(r.hours) ? r.hours : 0), 0);
  const holidays = calendar?.holidays ?? [];
  const workday = isWorkday(dateYmd) && !holidays.length;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const pasos: string[] = [];
  const future = futureDateBlocker(dateYmd);
  if (future) pasos.push(future);
  else if (!workday) pasos.push(holidays.length ? `Festivo (${holidays.join(", ")}): no reportar Ripor.` : "Fin de semana: no reportar Ripor.");
  else if (riporReports && reported !== undefined && reported < expected) {
    pasos.push(
      `Ripor: faltan ${expected - reported} h. Redactar descripción breve (50–500) desde azure.actividad y preguntar evidencia (preferir la HU padre). ` +
        `Luego: ripor preview --date ${dateYmd} --notes "…" --evidence <url> --sustained <horas sustentadas>`,
    );
  } else if (riporReports) pasos.push("Ripor: el día ya está completo.");
  if (chatCfg) pasos.push("Chat: mostrar borrador de inicio o cierre y enviar solo con aprobación (chat draft --inicio|--cierre → chat send).");

  const out = {
    fecha: dateYmd,
    zonaHoraria: tz,
    jornada: { laborable: workday, horasRipor: expected, festivos: holidays },
    azure: {
      organizaciones: azure.reports.map((r) => ({
        organizacion: r.organizationUrl,
        horasCompletadas: r.completedWorkHours,
        actividad: r.items.map((i) => ({
          id: i.id,
          titulo: i.title,
          tipo: i.type,
          proyecto: i.project,
          estado: i.state,
          cambiosDeEstado: i.stateChanges,
          horas: i.completedWorkDelta,
          creadaEseDia: i.createdToday,
          url: i.url,
        })),
      })),
      tareasAbiertas: azure.open.map((t) => ({ id: t.id, titulo: t.title, estado: t.state, url: t.url })),
      entregadas: azure.delivered.map((t) => ({ id: t.id, titulo: t.title, estado: t.state })),
    },
    reuniones: (calendar?.events ?? []).map((e) => ({
      hora: e.allDay ? "todo el día" : `${e.start}-${e.end}`,
      titulo: e.title,
      respuesta: e.myResponse,
      meet: e.meetUrl,
      evidencias: e.attachments.map((x) => ({ tipo: x.mime, titulo: x.title, url: x.url })),
    })),
    correosEnviados: mail ? mail.map((m) => ({ hora: m.time, asunto: m.subject, para: m.people, enlace: m.url })) : undefined,
    ripor: riporReports
      ? {
          reportado: reported,
          esperado: expected,
          reportes: riporReports.map((r) => ({ id: r.id, horas: r.hours, descripcion: r.description, evidencia: r.evidence })),
        }
      : null,
    chat: chatCfg
      ? {
          destino: chatCfg.target.title ?? chatCfg.target.url,
          borradorInicio: renderDayMessage("inicio", { dateYmd, tareas: azure.open }, chatCfg.templates, chatCfg.maxChars),
          borradorCierre: renderDayMessage(
            "cierre",
            { dateYmd, entregadas: azure.delivered, en_curso: azure.open.filter((t) => t.category === "InProgress") },
            chatCfg.templates,
            chatCfg.maxChars,
          ),
        }
      : null,
    siguientesPasos: pasos,
    errores,
  };
  console.log(JSON.stringify(out, null, 2));
}
