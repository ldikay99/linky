import type { DayActivity, ScheduleProfile } from "../types.js";
import { hoursForDate } from "./schedule.js";
import { formatHm, parseHm } from "./scheduleParse.js";

export type CoverageResult = {
  requiredMinutes: number;
  coveredMinutes: number;
  gaps: Array<{ start: string; end: string; minutes: number }>;
  overlaps: Array<{ a: string; b: string }>;
  ok: boolean;
  questions: string[];
};

/**
 * Valida cobertura de la jornada sin inventar actividades.
 * Reporta huecos/superposiciones reales y pregunta duración/actividad faltante.
 */
export function validateDayCoverage(
  schedule: ScheduleProfile,
  dateYmd: string,
  activities: DayActivity[],
  opts: { allowGaps?: boolean } = {},
): CoverageResult {
  const window = hoursForDate(schedule, dateYmd);
  if (!window) {
    return {
      requiredMinutes: 0,
      coveredMinutes: 0,
      gaps: [],
      overlaps: [],
      ok: true,
      questions: [],
    };
  }

  const dayStart = parseHm(window.start);
  const dayEnd = parseHm(window.end);
  let lunchStart = dayStart;
  let lunchEnd = dayStart;
  if (schedule.lunchStart && schedule.lunchEnd) {
    lunchStart = parseHm(schedule.lunchStart);
    lunchEnd = parseHm(schedule.lunchEnd);
  } else if (schedule.lunchMinutes > 0) {
    // Almuerzo centrado aproximado; solo para calcular minutos netos requeridos
    const mid = Math.floor((dayStart + dayEnd) / 2);
    lunchStart = mid - Math.floor(schedule.lunchMinutes / 2);
    lunchEnd = lunchStart + schedule.lunchMinutes;
  }

  const required =
    Math.max(0, dayEnd - dayStart) - Math.max(0, Math.min(lunchEnd, dayEnd) - Math.max(lunchStart, dayStart));

  type Seg = { start: number; end: number; id: string };
  const segs: Seg[] = [];
  const questions: string[] = [];

  for (const a of activities) {
    if (a.timeRange) {
      const s = parseHm(a.timeRange.start);
      const e = parseHm(a.timeRange.end);
      if (e <= s) {
        questions.push(`Actividad "${a.title}": rango horario inválido ${a.timeRange.start}–${a.timeRange.end}`);
        continue;
      }
      segs.push({ start: s, end: e, id: a.id });
    } else if (a.minutesSpent != null && a.kind === "done") {
      // Sin reloj de inicio: cuenta minutos pero no puede ubicar huecos temporales exactos
      questions.push(
        `Actividad "${a.title}": indica timeRange (HH:mm–HH:mm) para validar cobertura sin huecos/superposición`,
      );
    } else if (a.kind === "done" && a.minutesSpent == null) {
      questions.push(`Actividad "${a.title}": ¿cuántos minutos reales dedicaste?`);
    }
  }

  // overlaps
  const overlaps: Array<{ a: string; b: string }> = [];
  const sorted = [...segs].sort((x, y) => x.start - y.start);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].start < sorted[i].end) {
        overlaps.push({ a: sorted[i].id, b: sorted[j].id });
      }
    }
  }

  // merge for gaps outside lunch
  const workBlocks: Array<{ start: number; end: number }> = [];
  if (lunchEnd > lunchStart && lunchStart > dayStart) {
    workBlocks.push({ start: dayStart, end: Math.min(lunchStart, dayEnd) });
    if (lunchEnd < dayEnd) workBlocks.push({ start: lunchEnd, end: dayEnd });
  } else {
    workBlocks.push({ start: dayStart, end: dayEnd });
  }

  const gaps: Array<{ start: string; end: string; minutes: number }> = [];
  let covered = 0;
  for (const block of workBlocks) {
    const inBlock = sorted
      .map((s) => ({ start: Math.max(s.start, block.start), end: Math.min(s.end, block.end) }))
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start);
    let cursor = block.start;
    for (const s of inBlock) {
      if (s.start > cursor) {
        gaps.push({ start: formatHm(cursor), end: formatHm(s.start), minutes: s.start - cursor });
      }
      covered += s.end - s.start;
      cursor = Math.max(cursor, s.end);
    }
    if (cursor < block.end) {
      gaps.push({ start: formatHm(cursor), end: formatHm(block.end), minutes: block.end - cursor });
    }
  }

  // Also count minutesSpent when no timeRange as covered for totals only
  for (const a of activities) {
    if (!a.timeRange && a.minutesSpent != null) covered += a.minutesSpent;
  }

  // Día parcial pedido por la persona: los huecos se reportan pero no se preguntan (no se inventa con qué llenarlos).
  if (gaps.length && !opts.allowGaps) {
    for (const g of gaps) {
      questions.push(
        `Hueco ${g.start}–${g.end} (${g.minutes} min): ¿qué actividad real cubre ese tramo y con qué duración? (no inventar)`,
      );
    }
  }
  if (overlaps.length) {
    questions.push(`Hay superposición de rangos entre actividades; ajusta horarios reales.`);
  }

  const ok = (opts.allowGaps || gaps.length === 0) && overlaps.length === 0 && questions.length === 0;
  return { requiredMinutes: required, coveredMinutes: covered, gaps, overlaps, ok, questions };
}
