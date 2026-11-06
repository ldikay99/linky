/**
 * Regla: las descripciones (Ripor y Azure) NO llevan fechas. La fecha va en su campo
 * (día del reporte en Ripor, fecha de la Task en Azure), nunca en el texto.
 */
const MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sept|sep|oct|nov|dic";

const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/i, // 2026-11-04
  /\b(?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])(?:[/-]\d{2,4})?\b/i, // 04/11, 4-11-2026
  new RegExp(`\\b(?:0?[1-9]|[12]\\d|3[01])\\s+(?:de\\s+)?(?:${MONTHS})\\b\\.?(?:\\s+(?:de\\s+)?\\d{4})?`, "i"), // 4 de noviembre
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+(?:0?[1-9]|[12]\\d|3[01])\\b`, "i"), // nov 4
];

/** Fragmentos con forma de fecha encontrados en el texto. */
export function findDates(text: string): string[] {
  const found: string[] = [];
  for (const re of DATE_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) found.push(m[0].trim());
  }
  // Sin fragmentos contenidos en otra fecha ya detectada (p. ej. "11-05" dentro de "2026-11-05").
  const unique = [...new Set(found)];
  return unique.filter((f) => !unique.some((o) => o !== f && o.includes(f)));
}

export function noDatesError(text: string): string | undefined {
  const dates = findDates(text);
  return dates.length
    ? `La descripción no lleva fechas (${dates.join(", ")}): la fecha va en su campo, no en el texto.`
    : undefined;
}

/** Quita fechas de un texto sugerido automáticamente (p. ej. títulos con "del 04/11"). */
export function stripDates(text: string): string {
  let out = text;
  for (const re of DATE_PATTERNS) out = out.replace(new RegExp(re.source, re.flags + "g"), " ");
  return out
    .replace(/\b(?:del|el|al|de)\s+(?=[,.;:)]|\s*$)/gi, " ")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
