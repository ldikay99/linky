/**
 * Google Calendar sin API keys: descarga la exportación oficial (Configuración → Importar y exportar)
 * con la sesión de Google del perfil compartido de Linky, en headless. El ZIP se lee en memoria y se borra.
 */
import { readFile, rm } from "node:fs/promises";
import { openSharedBrowser, safeBrowserError } from "../browser/shared.js";
import { hasGoogleSession } from "../chat/browser.js";
import { eventsOnDate, parseIcs, type DayEvent } from "./ics.js";
import { unzipEntries } from "./zip.js";
import { classifyEvent, type MeetingRules } from "./meetings.js";

const EXPORT_URL = "https://calendar.google.com/calendar/exporticalzip";

export type CalendarFile = { name: string; ics: string };

export async function downloadCalendarExport(opts?: { dataDir?: string }): Promise<CalendarFile[]> {
  const context = await openSharedBrowser({ headless: true, dataDir: opts?.dataDir });
  try {
    if (!(await hasGoogleSession(context))) {
      throw new Error("No hay sesión de Google en el perfil de Linky. Ejecuta: npm run linky -- chat login (o calendar login).");
    }
    const page = context.pages()[0] ?? (await context.newPage());
    let zipPath: string | null = null;
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 90_000 }),
        page.goto(EXPORT_URL).catch(() => undefined), // la navegación "falla" porque termina en descarga
      ]);
      zipPath = await download.path();
      const buf = await readFile(zipPath!);
      return unzipEntries(buf)
        .filter((e) => e.name.toLowerCase().endsWith(".ics"))
        .map((e) => ({ name: e.name.replace(/\.ics$/i, ""), ics: e.data.toString("utf8") }));
    } catch (e) {
      throw safeBrowserError(e, "No se pudo exportar Google Calendar");
    } finally {
      if (zipPath) await rm(zipPath, { force: true }).catch(() => undefined);
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Calendario principal = el que se llama como la cuenta (correo), no grupos/festivos/importados. */
export function primaryCalendar(files: CalendarFile[]): CalendarFile | undefined {
  return files.find((f) => /^[^#\s]+@[^#\s]+\.[a-z]{2,}$/i.test(f.name) && !/calendar\.google\.com$/i.test(f.name));
}

export function isHolidayCalendar(name: string): boolean {
  return /#holiday@|holiday|festivo/i.test(name);
}

export type CalendarDay = {
  dateYmd: string;
  timeZone: string;
  account?: string;
  /** reunion: true = confirmada, false = ignorada, null = sin confirmar (preguntar a la persona). */
  events: Array<DayEvent & { calendar: string; reunion: boolean | null }>;
  holidays: string[];
  calendars: string[];
};

export function calendarDay(
  files: CalendarFile[],
  dateYmd: string,
  opts?: { timeZone?: string; allCalendars?: boolean; rules?: MeetingRules },
): CalendarDay {
  const tz = opts?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const primary = primaryCalendar(files);
  const account = primary?.name;
  const holidays: string[] = [];
  const events: CalendarDay["events"] = [];
  for (const f of files) {
    const day = eventsOnDate(parseIcs(f.ics, tz), dateYmd, tz, account);
    if (isHolidayCalendar(f.name)) {
      holidays.push(...day.map((e) => e.title));
      continue;
    }
    if (!opts?.allCalendars && f !== primary) continue;
    events.push(...day.map((e) => ({ ...e, calendar: f.name, reunion: opts?.rules ? classifyEvent(e.title, opts.rules) : null })));
  }
  return { dateYmd, timeZone: tz, account, events, holidays, calendars: files.map((f) => f.name) };
}
