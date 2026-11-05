import type { RiporScheduleConfig } from "./types.js";
import { DEFAULT_RIPOR_SCHEDULE } from "./types.js";

/** Fecha LOCAL del dispositivo YYYY-MM-DD → weekday 0=Dom … 6=Sáb */
export function weekdayLocalFromYmd(dateYmd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!m) throw new Error(`Fecha inválida: ${dateYmd}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Date.UTC weekday is same calendar day as local YMD interpretation for policy
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function isWorkday(dateYmd: string): boolean {
  const wd = weekdayLocalFromYmd(dateYmd);
  return wd >= 1 && wd <= 5;
}

export function expectedHoursForDate(
  dateYmd: string,
  schedule: RiporScheduleConfig = DEFAULT_RIPOR_SCHEDULE,
): number {
  const wd = weekdayLocalFromYmd(dateYmd);
  if (wd === 5) return schedule.expectedHoursFriday;
  if (wd >= 1 && wd <= 4) return schedule.expectedHoursMonThu;
  return 0;
}

export function workWindowLabel(
  dateYmd: string,
  schedule: RiporScheduleConfig = DEFAULT_RIPOR_SCHEDULE,
): string {
  const wd = weekdayLocalFromYmd(dateYmd);
  if (wd === 5) {
    return `${schedule.friStart}-${schedule.friEnd} (viernes; ${schedule.lunchBreakLabel})`;
  }
  if (wd >= 1 && wd <= 4) {
    return `${schedule.monThuStart}-${schedule.monThuEnd} (lun-jue; ${schedule.lunchBreakLabel})`;
  }
  return "no laboral";
}
