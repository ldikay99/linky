/**
 * Estado del mes en Ripor: qué días laborables faltan o están incompletos.
 * Laborable = lunes a viernes que no es festivo (Colombia + extra). Fines de semana y festivos no se exigen;
 * si alguien reportó horas en ellos se muestran como "extra".
 */
import { holidayName } from "./holidays.js";
import { expectedHoursForDate, isWorkday } from "./schedule.js";
import type { RiporScheduleConfig } from "./types.js";

export type DayStatus = "completo" | "incompleto" | "falta" | "exceso" | "festivo" | "fin de semana" | "extra" | "futuro";

export type MonthDay = { fecha: string; dia: string; estado: DayStatus; esperado: number; reportado: number; festivo?: string };

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const EPS = 1e-9;

export function monthDays(monthYm: string): string[] {
  const [y, m] = monthYm.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${monthYm}-${String(i + 1).padStart(2, "0")}`);
}

export function classifyMonth(input: {
  monthYm: string;
  todayYmd: string;
  reportedByDay: Record<string, number>;
  schedule?: RiporScheduleConfig;
  extraHolidays?: string[];
}): { dias: MonthDay[]; totales: { esperadoHastaHoy: number; reportado: number; faltante: number; diasPendientes: string[] } } {
  const dias: MonthDay[] = [];
  for (const fecha of monthDays(input.monthYm)) {
    const wd = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const reportado = input.reportedByDay[fecha] ?? 0;
    const festivo = isWorkday(fecha) ? holidayName(fecha, input.extraHolidays) : undefined;
    const laborable = isWorkday(fecha) && !festivo;
    const esperado = laborable ? expectedHoursForDate(fecha, input.schedule) : 0;
    let estado: DayStatus;
    if (fecha > input.todayYmd) estado = reportado > EPS ? "extra" : "futuro";
    else if (!laborable) estado = reportado > EPS ? "extra" : festivo ? "festivo" : "fin de semana";
    else if (reportado < EPS) estado = "falta";
    else if (reportado + EPS < esperado) estado = "incompleto";
    else if (reportado > esperado + EPS) estado = "exceso";
    else estado = "completo";
    dias.push({ fecha, dia: DIAS[wd], estado, esperado, reportado, ...(festivo ? { festivo } : {}) });
  }
  const pasados = dias.filter((d) => d.fecha <= input.todayYmd);
  const esperadoHastaHoy = pasados.reduce((s, d) => s + d.esperado, 0);
  const reportado = dias.reduce((s, d) => s + d.reportado, 0);
  const diasPendientes = dias.filter((d) => d.estado === "falta" || d.estado === "incompleto").map((d) => d.fecha);
  const faltante = Math.max(0, pasados.reduce((s, d) => s + (d.esperado > 0 ? Math.max(0, d.esperado - d.reportado) : 0), 0));
  return { dias, totales: { esperadoHastaHoy, reportado, faltante, diasPendientes } };
}
