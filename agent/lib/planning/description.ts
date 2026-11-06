import type { DescriptionStyle } from "../types.js";
import { noDatesError } from "./noDates.js";

export function validateDescription(
  text: string,
  kind: "planned" | "done",
  style: DescriptionStyle,
): { ok: boolean; errors: string[]; normalized: string } {
  const normalized = text.trim().replace(/\s+/g, " ");
  const errors: string[] = [];
  if (!normalized) errors.push("La descripción no puede estar vacía.");
  if (normalized.length > style.maxChars) errors.push(`Máximo ${style.maxChars} caracteres (va ${normalized.length}).`);
  if (style.requireShortDirect && normalized.length > 0 && normalized.length < 8) {
    errors.push("Demasiado corta: resume qué se hará o qué se hizo.");
  }
  const dated = noDatesError(normalized);
  if (dated) errors.push(dated);
  // Heurística suave de tiempo verbal; no bloquea, avisa
  if (kind === "planned" && /\b(hice|terminé|entregué|implementé)\b/i.test(normalized)) {
    errors.push("Planeación: escribe en futuro (qué se hará), no en pasado.");
  }
  if (kind === "done" && /\b(haré|implementaré|voy a)\b/i.test(normalized)) {
    errors.push("Ejecución: escribe en pasado (qué se hizo), no en futuro.");
  }
  return { ok: errors.length === 0, errors, normalized };
}
