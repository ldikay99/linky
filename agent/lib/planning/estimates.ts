import type { DayActivity, EstimatePolicy } from "../types.js";

/**
 * Aplica margen "un poco más" SOLO a estimación de planeación futura,
 * con aprobación explícita. Nunca modifica minutosSpent (reales).
 */
export function applyPlanningMargin(
  estimateMinutes: number,
  policy: EstimatePolicy,
  marginApproved: boolean,
): { estimateMinutes: number; appliedMargin: boolean; note: string } {
  if (!marginApproved) {
    return {
      estimateMinutes,
      appliedMargin: false,
      note: "Margen no aplicado (falta estimateMarginApproved).",
    };
  }
  const bumped = Math.ceil((estimateMinutes * (100 + policy.planningMarginPercent)) / 100);
  return {
    estimateMinutes: bumped,
    appliedMargin: true,
    note: `Margen +${policy.planningMarginPercent}% aprobado sobre estimación (no altera horas reales).`,
  };
}

export function summarizeEstimateVsActual(activities: DayActivity[]): {
  sumEstimate: number;
  sumActual: number;
  note: string;
} {
  const sumEstimate = activities.reduce((a, x) => a + (x.minutesEstimate ?? 0), 0);
  const sumActual = activities.reduce((a, x) => a + (x.minutesSpent ?? 0), 0);
  return {
    sumEstimate,
    sumActual,
    note: "Sumas transparentes: estimación y real son campos separados; no se fuerza desigualdad inventando minutos.",
  };
}
