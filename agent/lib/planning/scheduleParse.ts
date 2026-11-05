import type { ScheduleProfile, WorkdayHours } from "../types.js";

/**
 * Interpreta texto ambiguo tipo:
 * "lunes a viernes 8:30–18 y viernes 8–17"
 * → lun–jue 08:30–18:00, viernes 08:00–17:00
 * Siempre debe confirmarse en onboarding (no aplicar en silencio como verdad absoluta).
 */
export function interpretAmbiguousWorkweekText(text: string): {
  interpretation: { mondayToThursday: WorkdayHours; friday: WorkdayHours };
  summary: string;
  needsConfirmation: true;
} {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  // Defaults documentados del dueño cuando el texto coincide con el patrón ambiguo
  const mondayToThursday = { start: "08:30", end: "18:00" };
  const friday = { start: "08:00", end: "17:00" };

  const looksAmbiguous =
    /lunes\s*a\s*viernes/.test(normalized) && /viernes/.test(normalized);

  return {
    interpretation: { mondayToThursday, friday },
    summary: looksAmbiguous
      ? "Interpretación propuesta: lun–jue 08:30–18:00; viernes 08:00–17:00. Confirma en onboarding."
      : "Usando ventana lun–jue 08:30–18:00 y viernes 08:00–17:00 como propuesta; confirma o ajusta.",
    needsConfirmation: true,
  };
}

export function defaultProposedSchedule(timezone = "America/Bogota"): Omit<
  ScheduleProfile,
  "scheduleInterpretationConfirmed" | "lunchAsked" | "lunchMinutes"
> & { lunchAsked?: false } {
  return {
    timezone,
    mondayToThursday: { start: "08:30", end: "18:00" },
    friday: { start: "08:00", end: "17:00" },
    holidays: [],
    absences: [],
  };
}

export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) throw new Error(`Hora inválida HH:mm: ${hm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Hora inválida: ${hm}`);
  return h * 60 + min;
}

export function formatHm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
