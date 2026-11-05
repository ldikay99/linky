import type { LinkyProfile, ScheduleProfile } from "../types.js";

export function todayInBogota(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function weekdayInBogota(dateYmd: string): number {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, 17, 0, 0);
  return new Date(utc).getUTCDay();
}

export function isWorkingDay(schedule: ScheduleProfile, dateYmd: string): { working: boolean; reason?: string } {
  if (schedule.holidays.includes(dateYmd)) return { working: false, reason: "festivo configurado" };
  if (schedule.absences.includes(dateYmd)) return { working: false, reason: "ausencia configurada" };
  const wd = weekdayInBogota(dateYmd);
  if (wd === 0 || wd === 6) return { working: false, reason: "fin de semana" };
  return { working: true };
}

export function hoursForDate(schedule: ScheduleProfile, dateYmd: string): { start: string; end: string } | null {
  const check = isWorkingDay(schedule, dateYmd);
  if (!check.working) return null;
  const wd = weekdayInBogota(dateYmd);
  if (wd === 5) return schedule.friday;
  return schedule.mondayToThursday;
}

export function scheduleWindowLabel(profile: LinkyProfile, dateYmd: string): string {
  const hours = hoursForDate(profile.schedule, dateYmd);
  if (!hours) {
    const reason = isWorkingDay(profile.schedule, dateYmd).reason;
    return `${dateYmd}: no laborable (${reason}). No inventar tiempo.`;
  }
  const lunch =
    profile.schedule.lunchStart && profile.schedule.lunchEnd
      ? ` almuerzo ${profile.schedule.lunchStart}–${profile.schedule.lunchEnd}`
      : ` almuerzo ${profile.schedule.lunchMinutes} min (preguntado)`;
  return `${dateYmd} ${hours.start}–${hours.end} (${profile.schedule.timezone})${lunch}`;
}
