import type {
  RiporCoverageProof,
  RiporDraftFields,
  RiporExistingReport,
  RiporMutationOp,
  RiporProfile,
  RiporScheduleConfig,
} from "./types.js";
import { DEFAULT_RIPOR_SCHEDULE } from "./types.js";
import { expectedHoursForDate, isWorkday } from "./schedule.js";
import { validateEvidenceUrls } from "./evidence.js";
import { noDatesError } from "../planning/noDates.js";
import { holidayName } from "./holidays.js";

export type PolicyResult = {
  ok: boolean;
  blockers: string[];
  notes: string[];
  decisions: string[];
  proposedTotalHours: number;
  expectedHoursForDay: number;
  existingHoursSameDay: number;
};

const EPS = 1e-9;
/** Mínimo que valida el formulario oficial de Ripor. */
export const RIPOR_DESCRIPTION_MIN_CHARS = 50;
/** "Breve": tope por defecto (configurable en el perfil). */
export const RIPOR_DESCRIPTION_MAX_CHARS = 500;

/**
 * Suma horas de existentes. NaN/negativos/undefined NO se tratan como 0: fallan.
 */
export function sumExistingHoursStrict(
  reports: RiporExistingReport[],
  opts: { dateYmd: string; excludeId?: string },
): { ok: true; total: number; counted: number } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  let total = 0;
  let counted = 0;
  for (const r of reports) {
    if (opts.excludeId && r.id === opts.excludeId) continue;
    if (!r.id?.trim()) {
      errors.push("Reporte existente sin id.");
      continue;
    }
    if (r.dateYmd !== opts.dateYmd) {
      errors.push(`Reporte ${r.id} fecha ${r.dateYmd} ≠ día ${opts.dateYmd}.`);
      continue;
    }
    if (!Number.isFinite(r.hours)) {
      errors.push(`Reporte ${r.id}: hours no finito (NaN/Infinity) — no se trata como 0.`);
      continue;
    }
    if (r.hours < 0) {
      errors.push(`Reporte ${r.id}: hours negativo (${r.hours}).`);
      continue;
    }
    total += r.hours;
    counted += 1;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, total, counted };
}

function validUnder(
  draft: RiporDraftFields,
  mutationDateYmd: string,
): { ok: true; hours: number } | { ok: false; errors: string[] } {
  const under = draft.explicitUnderHoursRequest;
  if (!under) return { ok: false, errors: [] };
  const errors: string[] = [];
  if (!under.dateYmd || under.dateYmd !== mutationDateYmd) {
    errors.push(
      `Under-hours dateYmd debe vincularse a la mutación (${mutationDateYmd}); recibido ${under.dateYmd ?? "(vacío)"}.`,
    );
  }
  if (draft.dateYmd !== mutationDateYmd) {
    errors.push(`draft.dateYmd ${draft.dateYmd} ≠ mutación ${mutationDateYmd}.`);
  }
  if (!Number.isFinite(under.hours) || under.hours <= 0) {
    errors.push("Under-hours.hours debe ser finito > 0.");
  }
  if (Number.isFinite(under.hours) && under.hours !== draft.hours) {
    errors.push(`Under-hours ${under.hours}h ≠ draft.hours ${draft.hours}.`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, hours: under.hours };
}

/**
 * Cobertura fail-closed.
 *
 * DECISIÓN (ambigüedad → bloqueo):
 * - No basta `activitiesCoverFullDay: true` editable sin sustained numérico.
 * - Create/update exigen `coverageProof` con sustained finito ≥ draft.hours,
 *   O under-hours válido (fecha vinculada + cantidad).
 * - Sustained se compara con la dedicación del DRAFT (no se suma de nuevo el
 *   trabajo de otros reportes existentes del día → evita doble conteo).
 * - `activitiesCoverFullDay === false` + under válido + sustained ≥ draft → OK.
 * - `activitiesCoverFullDay === false` sin under → bloqueo.
 * - Flags/sustained ausentes → bloqueo (no aprobar por omisión).
 * - Fin de semana: under NO habilita create/update (evita bypass). Solo workday
 *   o bloqueo; excepción weekend requeriría campo futuro explícito (no inventado).
 */
export function evaluateCoverage(input: {
  draftHours: number;
  proposedTotal: number;
  expected: number;
  underOk: boolean;
  coverageProof?: RiporCoverageProof;
  /** Flag editable: solo se usa junto con proof; false sin under bloquea. */
  activitiesCoverFullDay?: boolean;
}): { blockers: string[]; notes: string[]; decisions: string[] } {
  const blockers: string[] = [];
  const notes: string[] = [];
  const decisions: string[] = [
    "Cobertura: fail-closed; proof positiva o under fecha+cantidad; no confiar solo en flags.",
    "Sustained vs draft.hours (no duplicar existentes del día).",
    "Weekend: under no bypass; create/update bloqueados en no-laborables.",
  ];

  const proof = input.coverageProof;
  if (!proof && !input.underOk) {
    blockers.push(
      "Falta coverageProof (sustained+coversDraftDedication) o under-hours autorizado fecha+cantidad. No aprobar por omisión.",
    );
    return { blockers, notes, decisions };
  }

  if (proof) {
    if (proof.coversDraftDedication !== true) {
      blockers.push("coverageProof.coversDraftDedication debe ser literal true.");
    }
    if (proof.source !== "azure_confirmed") {
      blockers.push('coverageProof.source debe ser "azure_confirmed".');
    }
    if (!Number.isFinite(proof.sustainedActivityHours) || proof.sustainedActivityHours < 0) {
      blockers.push("coverageProof.sustainedActivityHours debe ser finito ≥ 0 (NaN no cuenta como 0).");
    } else if (proof.sustainedActivityHours + EPS < input.draftHours) {
      blockers.push(
        `Sustained ${proof.sustainedActivityHours}h < draft ${input.draftHours}h: no inflar dedicación sobre actividades confirmadas.`,
      );
    }
  } else if (input.underOk) {
    notes.push("Under-hours válido: coverageProof opcional pero recomendado; sin proof no se exige sustained.");
    // Still fail-closed on under path without proof? Parent: "prueba positiva de cobertura o excepción autorizada"
    // Exception alone is enough for under path.
    decisions.push("Under autorizado exime coverageProof; sustained no obligatorio en under.");
  }

  if (input.activitiesCoverFullDay === false && !input.underOk) {
    blockers.push(
      "activitiesCoverFullDay=false sin under-hours autorizado: bloqueado (faltantes o excepción fecha+cantidad).",
    );
  }

  if (input.activitiesCoverFullDay === true && !proof) {
    blockers.push(
      "activitiesCoverFullDay=true sin coverageProof: flag editable no basta (fail-closed).",
    );
  }

  if (!input.underOk && input.expected > 0 && Math.abs(input.proposedTotal - input.expected) > EPS) {
    if (input.proposedTotal < input.expected) {
      blockers.push(
        `Jornada incompleta: total propuesto ${input.proposedTotal}h < esperado ${input.expected}h. Pedir faltantes o under fecha+cantidad.`,
      );
    }
  }

  return { blockers, notes, decisions };
}

/**
 * Políticas Ripor (fail-closed).
 */
export function evaluateRiporPolicy(input: {
  op: RiporMutationOp;
  dateYmd: string;
  draft?: RiporDraftFields;
  existingSameDay: RiporExistingReport[];
  profile: RiporProfile;
  schedule?: RiporScheduleConfig;
  reportId?: string;
  /** @deprecated prefer coverageProof; still accepted if mapped by caller */
  sustainedActivityHours?: number;
  activitiesCoverFullDay?: boolean;
  coverageProof?: RiporCoverageProof;
}): PolicyResult {
  const schedule = input.schedule ?? input.profile.schedule ?? DEFAULT_RIPOR_SCHEDULE;
  const blockers: string[] = [];
  const notes: string[] = [];
  const decisions: string[] = [];
  // Fin de semana o festivo trabajado y pedido por la persona: se reportan sus horas, nunca más de una jornada.
  const nonWorkday = !isWorkday(input.dateYmd) || Boolean(holidayName(input.dateYmd, input.profile.extraHolidays));
  const extraDay = nonWorkday && input.draft?.nonWorkdayConfirmed === true && input.op !== "delete";
  const existingForExtra = sumExistingHoursStrict(input.existingSameDay, { dateYmd: input.dateYmd });
  const expected = extraDay
    ? Math.min((existingForExtra.ok ? existingForExtra.total : 0) + (input.draft?.hours ?? 0), schedule.expectedHoursMonThu)
    : expectedHoursForDate(input.dateYmd, schedule);
  const targetId = input.reportId;

  const sumAll = sumExistingHoursStrict(input.existingSameDay, { dateYmd: input.dateYmd });
  if (!sumAll.ok) {
    return {
      ok: false,
      blockers: sumAll.errors,
      notes,
      decisions: ["Existentes inválidos → fail-closed; NaN≠0."],
      proposedTotalHours: Number.NaN,
      expectedHoursForDay: expected,
      existingHoursSameDay: Number.NaN,
    };
  }
  const existingTotal = sumAll.total;

  if (input.op === "delete") {
    if (!targetId) blockers.push("Delete requiere reportId explícito (fecha+id).");
    else {
      const target = input.existingSameDay.find((r) => r.id === targetId);
      if (!target) blockers.push(`Delete: reportId ${targetId} no existe en reportes del día ${input.dateYmd}.`);
      else if (target.dateYmd !== input.dateYmd) {
        blockers.push(`Delete: target fecha ${target.dateYmd} ≠ ${input.dateYmd}.`);
      } else if (!Number.isFinite(target.hours) || target.hours < 0) {
        blockers.push(`Delete: target hours inválido (no finito o negativo).`);
      }
    }
    const removed = input.existingSameDay.find((r) => r.id === targetId);
    const removedHours =
      removed && Number.isFinite(removed.hours) && removed.hours >= 0 ? removed.hours : 0;
    return {
      ok: blockers.length === 0,
      blockers,
      notes: [
        "Borrado solo con petición explícita fecha+id y confirmación separada.",
        "Nunca workaround delete+create sin permiso.",
      ],
      decisions: ["Delete no exige coverageProof."],
      proposedTotalHours: Math.max(0, existingTotal - removedHours),
      expectedHoursForDay: expected,
      existingHoursSameDay: existingTotal,
    };
  }

  if (input.draft?.skipDay) {
    return {
      ok: false,
      blockers: [
        `Día marcado sin trabajo/ausencia/festivo (${input.draft.skipReason ?? "sin motivo"}): no crear inventando.`,
      ],
      notes: [],
      decisions: ["skipDay siempre bloquea create/update."],
      proposedTotalHours: existingTotal,
      expectedHoursForDay: expected,
      existingHoursSameDay: existingTotal,
    };
  }

  // Festivo (Colombia + extra configurados): no se reporta, igual que fin de semana.
  const holiday = isWorkday(input.dateYmd) ? holidayName(input.dateYmd, input.profile.extraHolidays) : undefined;
  if (extraDay) {
    notes.push(`Día no laborable (${holiday ? `festivo: ${holiday}` : "fin de semana"}) trabajado: se reporta porque la persona lo pidió; tope ${schedule.expectedHoursMonThu} h.`);
    if ((input.draft?.hours ?? 0) > schedule.expectedHoursMonThu + 1e-9) {
      blockers.push(`Trabajo extra: ${input.draft?.hours} h supera una jornada completa (${schedule.expectedHoursMonThu} h).`);
    }
  } else if (holiday) {
    blockers.push(`Festivo (${holiday}): no se reporta en Ripor.`);
  }

  // Weekend: under NO bypass (salvo trabajo extra confirmado por la persona)
  if (!isWorkday(input.dateYmd) && !extraDay) {
    blockers.push(
      "Fin de semana / no laboral: create/update bloqueados. Under-hours no habilita weekend (sin campo weekend-exception).",
    );
    decisions.push("DECISIÓN: under no bypass weekend; ambigüedad → bloqueo.");
  }

  if (!input.draft) {
    blockers.push("Faltan campos del draft.");
    return {
      ok: false,
      blockers,
      notes,
      decisions,
      proposedTotalHours: existingTotal,
      expectedHoursForDay: expected,
      existingHoursSameDay: existingTotal,
    };
  }

  const draft = input.draft;
  if (draft.dateYmd !== input.dateYmd) {
    blockers.push(`draft.dateYmd ${draft.dateYmd} ≠ mutación ${input.dateYmd}.`);
  }

  if (input.op === "update") {
    if (!targetId) blockers.push("Update requiere reportId.");
    else {
      const target = input.existingSameDay.find((r) => r.id === targetId);
      if (!target) blockers.push(`Update: reportId ${targetId} no existe en el día ${input.dateYmd}.`);
    }
  }

  const othersSum = sumExistingHoursStrict(input.existingSameDay, {
    dateYmd: input.dateYmd,
    excludeId: input.op === "update" ? targetId : undefined,
  });
  if (!othersSum.ok) {
    blockers.push(...othersSum.errors);
  }
  const others = othersSum.ok ? othersSum.total : Number.NaN;

  if (!draft.areaProjectLabel?.trim()) {
    blockers.push(
      "Proyecto de área Ripor obligatorio (distinto de proyectos Azure). Elegir de opciones UI reales; nunca default IDs de ejemplo.",
    );
  }
  if (!draft.taskLabel?.trim()) {
    blockers.push('Tarea obligatoria (confirmar label UI; observado genérico: "Tarea Personalizada").');
  }
  if (!draft.description?.trim()) {
    blockers.push(
      "Descripción breve desde actividades Azure confirmadas (sin fabricar ni mezclar plan futuro como hecho).",
    );
  }
  const desc = draft.description?.trim() ?? "";
  if (desc && desc.length < RIPOR_DESCRIPTION_MIN_CHARS) {
    blockers.push(`Descripción muy corta: ${desc.length} caracteres (Ripor exige mínimo ${RIPOR_DESCRIPTION_MIN_CHARS}).`);
  }
  const dated = desc ? noDatesError(desc) : undefined;
  if (dated) blockers.push(dated);
  const maxDesc = input.profile.descriptionMaxChars ?? RIPOR_DESCRIPTION_MAX_CHARS;
  if (desc.length > maxDesc) {
    blockers.push(`Descripción no es breve: ${desc.length} caracteres > ${maxDesc}. Resumir.`);
  }
  const ev = validateEvidenceUrls(draft.evidenceUrls);
  if (!ev.ok) blockers.push(...ev.errors);
  if (!draft.transportLabel?.trim()) {
    blockers.push("Medio de transporte obligatorio (setup una vez; override diario no reescribe default).");
  }

  const hours = draft.hours;
  if (!Number.isFinite(hours) || hours <= 0) {
    blockers.push("Dedicación (horas) debe ser numérica finita > 0 (NaN no cuenta como 0).");
  }

  const proposedTotal =
    Number.isFinite(others) && Number.isFinite(hours) && hours > 0 ? others + hours : Number.NaN;

  if (Number.isFinite(proposedTotal) && expected > 0 && proposedTotal > expected + EPS) {
    blockers.push(
      `Excede máximo del día: propuesto ${proposedTotal}h > esperado ${expected}h (suma todos los reportes de la fecha).`,
    );
  }

  const underResult = validUnder(draft, input.dateYmd);
  if (draft.explicitUnderHoursRequest) {
    if (!underResult.ok) blockers.push(...underResult.errors);
    else notes.push(`Under-hours autorizado solo para ${input.dateYmd}; no permanente.`);
  }

  // Map legacy sustained + flag into proof if provided completely
  let proof = input.coverageProof;
  if (
    !proof &&
    input.sustainedActivityHours !== undefined &&
    input.activitiesCoverFullDay === true &&
    Number.isFinite(input.sustainedActivityHours)
  ) {
    proof = {
      sustainedActivityHours: input.sustainedActivityHours,
      coversDraftDedication: true,
      source: "azure_confirmed",
    };
    notes.push("coverageProof sintetizado desde sustained+activitiesCoverFullDay=true (legacy).");
  }

  const cov = evaluateCoverage({
    draftHours: Number.isFinite(hours) ? hours : Number.NaN,
    proposedTotal: Number.isFinite(proposedTotal) ? proposedTotal : Number.NaN,
    expected,
    underOk: underResult.ok === true && Boolean(draft.explicitUnderHoursRequest),
    coverageProof: proof,
    activitiesCoverFullDay: input.activitiesCoverFullDay,
  });
  blockers.push(...cov.blockers);
  notes.push(...cov.notes);
  decisions.push(...cov.decisions);

  notes.push(
    "Horas = dedicación numérica; no timestamps inventados.",
    "Idempotencia: UI incierta → fail-closed; no repetir POST/click guardar.",
    "Sumar existentes para evitar duplicados; revalidar en apply.",
  );

  return {
    ok: blockers.length === 0,
    blockers,
    notes,
    decisions,
    proposedTotalHours: proposedTotal,
    expectedHoursForDay: expected,
    existingHoursSameDay: existingTotal,
  };
}
