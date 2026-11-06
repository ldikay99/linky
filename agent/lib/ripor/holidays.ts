/**
 * Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani"), calculados sin red:
 * fijos, trasladables al lunes siguiente y los ligados a la Pascua.
 */

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Domingo de Pascua (algoritmo gregoriano anónimo / Meeus). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Traslado Emiliani: si no cae lunes, pasa al lunes siguiente. */
function nextMonday(d: Date): Date {
  const wd = d.getUTCDay();
  return wd === 1 ? d : addDays(d, (8 - wd) % 7 || 7);
}

export function colombiaHolidays(year: number): Map<string, string> {
  const map = new Map<string, string>();
  // Dos festivos pueden caer el mismo lunes (p. ej. 2025-06-30): se muestran ambos.
  const out = { set: (k: string, v: string) => map.set(k, map.has(k) ? `${map.get(k)} y ${v}` : v) };
  const fixed: Array<[number, number, string]> = [
    [1, 1, "Año Nuevo"],
    [5, 1, "Día del Trabajo"],
    [7, 20, "Independencia de Colombia"],
    [8, 7, "Batalla de Boyacá"],
    [12, 8, "Inmaculada Concepción"],
    [12, 25, "Navidad"],
  ];
  for (const [m, d, name] of fixed) out.set(ymd(new Date(Date.UTC(year, m - 1, d))), name);

  const movable: Array<[number, number, string]> = [
    [1, 6, "Reyes Magos"],
    [3, 19, "San José"],
    [6, 29, "San Pedro y San Pablo"],
    [8, 15, "Asunción de la Virgen"],
    [10, 12, "Día de la Raza"],
    [11, 1, "Todos los Santos"],
    [11, 11, "Independencia de Cartagena"],
  ];
  for (const [m, d, name] of movable) out.set(ymd(nextMonday(new Date(Date.UTC(year, m - 1, d)))), name);

  const easter = easterSunday(year);
  out.set(ymd(addDays(easter, -3)), "Jueves Santo");
  out.set(ymd(addDays(easter, -2)), "Viernes Santo");
  out.set(ymd(addDays(easter, 43)), "Ascensión del Señor");
  out.set(ymd(addDays(easter, 64)), "Corpus Christi");
  out.set(ymd(addDays(easter, 71)), "Sagrado Corazón");
  return map;
}

/** Festivo de esa fecha (Colombia + festivos extra configurados), o undefined. */
export function holidayName(dateYmd: string, extra: string[] = []): string | undefined {
  if (extra.includes(dateYmd)) return "Festivo configurado";
  return colombiaHolidays(Number(dateYmd.slice(0, 4))).get(dateYmd);
}
