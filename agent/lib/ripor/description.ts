/**
 * Brief daily description desde tareas/actividades Azure CONFIRMADAS.
 * Sin fabricar trabajo ni mezclar plan futuro como hecho.
 */

export type ConfirmedAzureActivity = {
  id?: string | number;
  title: string;
  /** Solo texto de lo YA hecho / confirmado */
  doneSummary?: string;
  state?: string;
  /** Si true, es plan futuro → no incluir como hecho */
  isFuturePlan?: boolean;
  projectHint?: string;
};

export function buildRiporDailyDescription(
  activities: ConfirmedAzureActivity[],
  opts?: { maxChars?: number },
): { description: string; used: ConfirmedAzureActivity[]; rejected: ConfirmedAzureActivity[]; warnings: string[] } {
  const maxChars = opts?.maxChars ?? 1200;
  const warnings: string[] = [];
  const rejected: ConfirmedAzureActivity[] = [];
  const used: ConfirmedAzureActivity[] = [];

  for (const a of activities) {
    if (a.isFuturePlan) {
      rejected.push(a);
      warnings.push(`Excluido plan futuro: ${a.title}`);
      continue;
    }
    if (!a.title?.trim() && !a.doneSummary?.trim()) {
      rejected.push(a);
      continue;
    }
    used.push(a);
  }

  if (used.length === 0) {
    return {
      description: "",
      used,
      rejected,
      warnings: [...warnings, "Sin actividades confirmadas: no fabricar descripción."],
    };
  }

  const parts = used.map((a) => {
    const body = (a.doneSummary ?? a.title).trim();
    const prefix = a.projectHint ? `[${a.projectHint}] ` : "";
    return `${prefix}${body}`;
  });

  let description = parts.join(". ");
  if (!description.endsWith(".")) description += ".";
  if (description.length > maxChars) {
    description = description.slice(0, maxChars - 1).trimEnd() + "…";
    warnings.push(`Descripción truncada a ${maxChars} caracteres.`);
  }

  return { description, used, rejected, warnings };
}
