/**
 * `linky alerts`: avisos proactivos (al empezar o terminar el día). Solo lectura; cada fuente falla por separado.
 */
import { buildAlerts } from "../alerts/alerts.js";
import { loadAzureOrgs } from "../azure/orgs.js";
import { findOrphanBrowsers } from "../browser/cleanup.js";
import { openSharedBrowser } from "../browser/shared.js";
import { calendarDay, downloadCalendarExport } from "../calendar/export.js";
import { loadMeetingRules } from "../calendar/meetings.js";
import { hasGoogleSession } from "../chat/browser.js";
import { myOpenTasks } from "../chat/dayMessages.js";
import { loadProfile } from "../profile/store.js";
import { describeRiporSession, loadRiporSession, resolveRiporSecretStore } from "../ripor/http/session.js";
import { holidayName } from "../ripor/holidays.js";
import { loadRiporJournal, riporJournalBlocksMutations } from "../ripor/journal.js";
import { classifyMonth, monthDays } from "../ripor/month.js";
import { loadRiporProfile } from "../ripor/profileStore.js";
import { expectedHoursForDate, isWorkday } from "../ripor/schedule.js";
import { resolveAzureAccess, whoAmI } from "./azureCmd.js";
import { applyPatExpiriesFromMail } from "./patMailCmd.js";
import { openRiporHttpFresh, todayLocalYmd, type argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

export async function runAlerts(a: Argv, dataDir?: string): Promise<void> {
  const today = todayLocalYmd();
  const now = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const errores: Record<string, string> = {};
  const short = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 160);
  const rp = await loadRiporProfile(dataDir);
  const laborableHoy = isWorkday(today) && !holidayName(today, rp?.extraHolidays);
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  const finJornada = rp ? (wd === 5 ? rp.schedule.friEnd : rp.schedule.monThuEnd) : undefined;
  // Avisar desde media hora antes del fin de la jornada.
  const finMenos30 = finJornada
    ? new Date(Date.UTC(2000, 0, 1, Number(finJornada.slice(0, 2)), Number(finJornada.slice(3)) - 30)).toISOString().slice(11, 16)
    : undefined;

  const riporJob = (async () => {
    if (!rp?.setupComplete) return undefined;
    const sesion = describeRiporSession(await loadRiporSession(await resolveRiporSecretStore())).present;
    const journal = riporJournalBlocksMutations(await loadRiporJournal(dataDir));
    if (!sesion) return { sesion, esperadoHoy: 0, diasPendientesMes: [], journalBloqueado: journal.reason };
    try {
      const { adapter } = await openRiporHttpFresh(rp);
      const days = monthDays(today.slice(0, 7)).filter((d) => d <= today);
      const reportedByDay: Record<string, number> = {};
      for (let i = 0; i < days.length; i += 6) {
        const chunk = days.slice(i, i + 6);
        const res = await Promise.all(chunk.map((d) => adapter.reportsForDate(d)));
        chunk.forEach((d, k) => (reportedByDay[d] = res[k].reduce((s, r) => s + (Number.isFinite(r.hours) ? r.hours : 0), 0)));
      }
      const month = classifyMonth({ monthYm: today.slice(0, 7), todayYmd: today, reportedByDay, schedule: rp.schedule, extraHolidays: rp.extraHolidays });
      return {
        sesion,
        reportadoHoy: reportedByDay[today] ?? 0,
        esperadoHoy: laborableHoy ? expectedHoursForDate(today, rp.schedule) : 0,
        diasPendientesMes: month.totales.diasPendientes,
        journalBloqueado: journal.reason,
      };
    } catch (e) {
      errores.ripor = short(e);
      return undefined;
    }
  })();

  const azureJob = (async () => {
    const reg = await loadAzureOrgs(dataDir);
    const profile = await loadProfile(dataDir);
    // Cada token se prueba de verdad (connectionData): si falla, aviso alto.
    const pats = await Promise.all(
      reg.orgs.map(async (o) => {
        let funciona: boolean | undefined;
        try {
          const access = await resolveAzureAccess({ org: o.organizationUrl, dataDir });
          await whoAmI(access.organizationUrl, access.auth);
          funciona = true;
        } catch (e) {
          funciona = /AZURE_AUTH_INVALID|no válida|401/i.test(String((e as Error).message)) ? false : undefined;
        }
        return {
          organizacion: o.organizationUrl,
          vence: o.expiresOn ?? (reg.primary === o.organizationUrl ? profile?.patLifecycle?.expiresOn : undefined),
          funciona,
        };
      }),
    );
    let tareas: Array<{ id: number; titulo: string; desde?: string }> = [];
    try {
      const access = await resolveAzureAccess({ dataDir });
      tareas = (await myOpenTasks({ organizationUrl: access.organizationUrl, auth: access.auth }))
        .filter((t) => t.category === "InProgress")
        .map((t) => ({ id: t.id, titulo: t.title, desde: t.stateChangedAt }));
    } catch (e) {
      errores.azure = short(e);
    }
    return { pats, tareas, conectada: reg.orgs.length > 0 };
  })();

  // Navegador: una sola sesión para Google + Calendar (en secuencia, mismo perfil). Espera a Ripor, que puede
  // abrir ese mismo perfil para renovar su sesión: dos procesos no pueden usarlo a la vez.
  const browserJob = riporJob.then(async () => {
    let google: boolean | undefined;
    let sinClasificar: number | undefined;
    let avisosAzure: Array<{ organization: string; expiresOn: string }> | undefined;
    if (a.has("--no-browser")) return { google, sinClasificar };
    try {
      const ctx = await openSharedBrowser({ headless: true, dataDir });
      try {
        google = await hasGoogleSession(ctx);
      } finally {
        await ctx.close().catch(() => undefined);
      }
      if (google) {
        const cal = calendarDay(await downloadCalendarExport({ dataDir }), today, { rules: await loadMeetingRules(dataDir) });
        sinClasificar = cal.events.filter((e) => e.reunion === null && !e.allDay).length;
        // Correos de Azure: completar vencimientos desconocidos y traer avisos "nearing expiration".
        const mail = await applyPatExpiriesFromMail(dataDir, undefined, { days: 14, max: 5 }).catch(() => undefined);
        avisosAzure = mail?.avisosDeAzure;
      }
    } catch (e) {
      errores.google = short(e);
    }
    return { google, sinClasificar, avisosAzure };
  });

  const [ripor, azure, browser] = await Promise.all([riporJob, azureJob, browserJob]);
  let huerfanos = 0;
  try {
    huerfanos = findOrphanBrowsers(dataDir).length;
  } catch (e) {
    errores.procesos = short(e);
  }
  const alertas = buildAlerts({
    todayYmd: today,
    nowHHmm: now,
    laborableHoy,
    finJornadaHHmm: finMenos30,
    ripor,
    pats: azure.pats,
    avisosAzure: browser.avisosAzure,
    tareasEnCurso: azure.tareas,
    diasEstancada: Number(a.arg("--stale-days") ?? 7),
    eventosSinClasificar: browser.sinClasificar,
    huerfanos,
    google: browser.google,
    sinConfigurar: [...(azure.conectada ? [] : (["azure"] as const)), ...(rp?.setupComplete ? [] : (["ripor"] as const))],
  });
  console.log(JSON.stringify({ fecha: today, hora: now, alertas, errores }, null, 2));
}
