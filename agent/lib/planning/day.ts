import type { DayActivity, DayPlan, LinkyProfile } from "../types.js";
import { validateDescription } from "./description.js";
import { noDatesError } from "./noDates.js";
import { scheduleWindowLabel, todayInBogota } from "./schedule.js";
import { evidenceMissing, validateLinks } from "../evidence/attachments.js";
import { validateDayCoverage } from "./coverage.js";
import { applyPlanningMargin, summarizeEstimateVsActual } from "./estimates.js";

export type DayInput = {
  date?: string;
  activities: Array<Partial<DayActivity> & { title: string; kind: "planned" | "done"; shortDescription?: string }>;
};

export function buildDayPlan(profile: LinkyProfile, input: DayInput): DayPlan {
  const date = input.date ?? todayInBogota();
  const missing: string[] = [];
  const warnings: string[] = [scheduleWindowLabel(profile, date)];
  const activities: DayActivity[] = [];

  if (!profile.azure.project?.trim()) {
    missing.push("Setup incompleto: falta proyecto Azure (obligatorio).");
  }
  if (!profile.workContext?.occupation || !profile.workContext?.projectContext) {
    missing.push("Setup incompleto: ocupación y contexto del proyecto son obligatorios para redactar HU/Tasks.");
  }
  if (!profile.schedule.scheduleInterpretationConfirmed) {
    warnings.push("Horario aún no confirmado en onboarding (interpretación lun–jue / viernes).");
  }
  if (!profile.schedule.lunchAsked) {
    missing.push("Falta preguntar almuerzo (no inventar horario de almuerzo).");
  }

  if (!input.activities.length) {
    missing.push("¿Qué actividades reales planeas o hiciste hoy? (título + descripción corta)");
  }

  for (const [idx, raw] of input.activities.entries()) {
    const id = raw.id ?? `act-${date}-${idx + 1}`;
    const desc = raw.shortDescription ?? "";
    const v = validateDescription(desc, raw.kind, profile.description);
    if (!v.ok) missing.push(`Actividad "${raw.title}": ${v.errors.join("; ")}`);
    const explicitDesc = raw.fields?.["System.Description"];
    const explicitDatesErr =
      typeof explicitDesc === "string" ? noDatesError(explicitDesc.replace(/<[^>]+>/g, " ")) : undefined;
    if (explicitDatesErr) missing.push(`Actividad "${raw.title}": ${explicitDatesErr}`);

    const links = raw.evidenceLinks ?? [];
    const meetings = raw.meetingOrCallLinks ?? [];
    const images = raw.evidenceImages ?? [];
    const linkCheck = validateLinks([...links, ...meetings], profile.evidence);
    if (!linkCheck.ok) missing.push(`Actividad "${raw.title}": ${linkCheck.errors.join("; ")}`);
    warnings.push(...linkCheck.warnings.map((w) => `"${raw.title}": ${w}`));

    let minutesEstimate = raw.minutesEstimate;
    if (raw.kind === "planned" && minutesEstimate != null) {
      const m = applyPlanningMargin(minutesEstimate, profile.estimate, raw.estimateMarginApproved === true);
      if (m.appliedMargin) {
        minutesEstimate = m.estimateMinutes;
        warnings.push(`"${raw.title}": ${m.note}`);
      } else if (profile.estimate.requireMarginApproval) {
        warnings.push(`"${raw.title}": ${m.note}`);
      }
    }

    if (raw.kind === "done") {
      if (raw.minutesSpent == null) {
        missing.push(`Actividad "${raw.title}": ¿cuántos minutos reales dedicaste? (no se infieren ni se inflan)`);
      }
      if (evidenceMissing({ evidenceLinks: links, evidenceImages: images, meetingOrCallLinks: meetings })) {
        missing.push(`Actividad "${raw.title}": adjunta evidencia (enlace o foto)`);
      }
    }

    const typeName = raw.workItemType ?? "Task";
    if (
      (raw.kind === "planned" || raw.kind === "done") &&
      (typeName === "User Story" || /historia|user story/i.test(String(typeName))) &&
      profile.huCreation === "scrum_or_third_party_only" &&
      raw.workItemId == null
    ) {
      missing.push(
        `HU "${raw.title}": la crea/refina scrum/tercero — indica workItemId de la HU existente (no crear/clonar/mover contra política)`,
      );
    }
    if ((typeName === "Task" || /task|tarea/i.test(String(typeName))) && raw.parentHuId == null && raw.workItemId == null) {
      missing.push(`Task "${raw.title}": indica parentHuId (HU padre en el mismo proyecto) o workItemId existente`);
    }

    // Title convention hint
    if (profile.workContext.titleConvention && raw.kind === "planned") {
      warnings.push(`Convención de título configurada: ${profile.workContext.titleConvention}`);
    }

    activities.push({
      id,
      kind: raw.kind,
      title: raw.title,
      shortDescription: v.normalized || desc,
      workItemId: raw.workItemId,
      parentHuId: raw.parentHuId,
      workItemType: typeName,
      minutesSpent: raw.minutesSpent,
      minutesEstimate,
      estimateMarginApproved: raw.estimateMarginApproved,
      evidenceLinks: links,
      evidenceImages: images,
      meetingOrCallLinks: meetings,
      notes: raw.notes,
      expectedRev: raw.expectedRev,
      fields: raw.fields,
      timeRange: raw.timeRange,
    });
  }

  const coverage = validateDayCoverage(profile.schedule, date, activities);
  missing.push(...coverage.questions);
  const sums = summarizeEstimateVsActual(activities);
  warnings.push(`${sums.note} Σest=${sums.sumEstimate}min Σreal=${sums.sumActual}min`);

  return {
    date,
    activities,
    missingQuestions: missing,
    warnings,
    coverage: {
      requiredMinutes: coverage.requiredMinutes,
      coveredMinutes: coverage.coveredMinutes,
      gaps: coverage.gaps,
      overlaps: coverage.overlaps,
    },
  };
}
