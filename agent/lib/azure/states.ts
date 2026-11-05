import type { ProcessMeta, StateMeta } from "../types.js";

export type DeliveryIntent = "entregado" | "cerrado" | "en_curso" | "planeado";

const CLOSED_NAME = /^(closed|cerrad[oa]|4\.?\s*cerrad[oa])$/i;
const CLOSED_CAT = /completed|removed/i;
const COMPLETED_NAME = /^(completed|complete|done|finalizad[oa])$/i;

/** Quita prefijos de orden de procesos personalizados: "3. Entregado", "2 - En curso", "X. Removido". */
export function stateBaseName(name: string): string {
  return name.trim().replace(/^[0-9A-Za-z]{1,2}\s*[.)\-]\s+/, "").toLowerCase();
}

export function isClosedLikeState(state: StateMeta): boolean {
  const name = state.name.trim();
  if (CLOSED_NAME.test(name)) return true;
  if (COMPLETED_NAME.test(name)) return true;
  if (state.category && CLOSED_CAT.test(state.category) && !/entregado/i.test(name)) {
    // Category Completed/Closed often means terminal close — treat as close-like
    if (/closed|cerrad|completed|done/i.test(name)) return true;
  }
  return false;
}

/**
 * Estados por defecto permitidos sin cierre: planeación / en curso / entregado.
 * Cerrado/Completed/4.Cerrado NUNCA se eligen automáticamente.
 */
export function resolveTargetState(
  meta: ProcessMeta,
  intent: DeliveryIntent,
): { state?: string; needsConfirmation: boolean; reason: string; isCloseLike: boolean } {
  const entries = meta.states.map((s) => ({ raw: s.name, l: s.name.toLowerCase().trim(), base: stateBaseName(s.name), meta: s }));

  if (intent === "planeado") {
    const hit = entries.find((s) => /to\s*do|new|proposed|backlog|pendiente|planeaci/.test(s.l) && !isClosedLikeState(s.meta));
    return hit
      ? { state: hit.raw, needsConfirmation: false, reason: "Estado de planeación detectado", isCloseLike: false }
      : { needsConfirmation: true, reason: "No se detectó estado de planeación; confirme el nombre.", isCloseLike: false };
  }

  if (intent === "en_curso") {
    const hit = entries.find((s) => /progress|active|doing|curso/i.test(s.l) && !isClosedLikeState(s.meta));
    return hit
      ? { state: hit.raw, needsConfirmation: false, reason: "Estado en curso detectado", isCloseLike: false }
      : { needsConfirmation: true, reason: "No se detectó estado en curso.", isCloseLike: false };
  }

  if (intent === "entregado") {
    // Prefer exact Entregado; never pick Closed/Completed/4.Cerrado
    const exact = entries.find((s) => s.base === "entregado" && !isClosedLikeState(s.meta));
    if (exact) return { state: exact.raw, needsConfirmation: false, reason: "Estado Entregado exacto", isCloseLike: false };
    const hit = entries.find(
      (s) => /entregado|resolved/i.test(s.l) && !isClosedLikeState(s.meta) && !/closed|cerrad|completed|done/i.test(s.l),
    );
    return hit
      ? { state: hit.raw, needsConfirmation: true, reason: "Candidato a entregado (confirme; no es cierre).", isCloseLike: false }
      : { needsConfirmation: true, reason: "No hay estado Entregado distinguible de Closed/Completed.", isCloseLike: false };
  }

  // intent === cerrado — solo si el caller ya trae intención explícita; aquí solo resolvemos nombre
  const closed =
    entries.find((s) => CLOSED_NAME.test(s.raw.trim())) ||
    entries.find((s) => /closed|cerrad/i.test(s.l)) ||
    entries.find((s) => s.meta.category && /completed/i.test(s.meta.category) && COMPLETED_NAME.test(s.raw.trim()));
  return closed
    ? { state: closed.raw, needsConfirmation: false, reason: "Estado de cierre localizado (requiere intención+aprobación separada)", isCloseLike: true }
    : { needsConfirmation: true, reason: "No se localizó Closed/Completed/Cerrado.", isCloseLike: true };
}

export function canTransition(meta: ProcessMeta, from: string | undefined, to: string): boolean {
  if (!meta.transitions.length) return true;
  if (!from) return meta.transitions.some((t) => t.to === to);
  return meta.transitions.some((t) => t.from === from && t.to === to);
}

/** Intents permitidos sin cierre explícito. */
export const DEFAULT_SAFE_INTENTS: DeliveryIntent[] = ["planeado", "en_curso", "entregado"];
