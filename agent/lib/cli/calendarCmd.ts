/**
 * Google Calendar: reuniones del día como evidencia (Meet, adjuntos de Drive, enlaces) y festivos.
 */
import { calendarDay, downloadCalendarExport } from "../calendar/export.js";
import { todayLocalYmd, type argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

export async function runCalendarCommand(sub: string | undefined, a: Argv, dataDir?: string): Promise<void> {
  if (sub === "day") {
    const files = await downloadCalendarExport({ dataDir });
    const day = calendarDay(files, a.arg("--date") ?? todayLocalYmd(), { allCalendars: a.has("--all-calendars") });
    console.log(JSON.stringify(day, null, 2));
    return;
  }
  console.log(`linky calendar <day>
  day [--date YYYY-MM-DD] [--all-calendars]   reuniones del día: hora, Meet, adjuntos (fotos/notas/grabaciones), enlaces; festivos
  (usa la sesión de Google del perfil de Linky: npm run linky -- chat login si aún no iniciaste sesión)`);
  if (sub) process.exitCode = 1;
}
