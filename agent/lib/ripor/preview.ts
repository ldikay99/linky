import type {
  RiporApproval,
  RiporCoverageProof,
  RiporDraftFields,
  RiporExistingReport,
  RiporMutationOp,
  RiporPreview,
  RiporProfile,
} from "./types.js";
import { RIPOR_PUBLIC_URL } from "./types.js";
import { evaluateRiporPolicy } from "./policy.js";
import { riporSnapshotHash } from "./hash.js";
import { workWindowLabel } from "./schedule.js";
import { validateEvidenceUrls } from "./evidence.js";

export function buildRiporPreview(input: {
  op: RiporMutationOp;
  dateYmd: string;
  draft?: RiporDraftFields;
  existingSameDay: RiporExistingReport[];
  profile: RiporProfile;
  reportId?: string;
  activitiesCoverFullDay?: boolean;
  sustainedActivityHours?: number;
  coverageProof?: RiporCoverageProof;
}): RiporPreview {
  // Evidence: always re-validate; never trust caller-edited "validated" flags.
  let draft = input.draft;
  let evidenceValidated: string[] = [];
  if (draft) {
    const ev = validateEvidenceUrls(draft.evidenceUrls);
    evidenceValidated = ev.urls;
    draft = { ...draft, evidenceUrls: ev.ok ? ev.urls : draft.evidenceUrls };
  }

  const policy = evaluateRiporPolicy({
    op: input.op,
    dateYmd: input.dateYmd,
    draft,
    existingSameDay: input.existingSameDay,
    profile: input.profile,
    reportId: input.reportId,
    activitiesCoverFullDay: input.activitiesCoverFullDay,
    sustainedActivityHours: input.sustainedActivityHours,
    coverageProof: input.coverageProof,
  });

  const before =
    input.reportId != null
      ? input.existingSameDay.find((r) => r.id === input.reportId)
      : undefined;

  const after =
    input.op === "delete"
      ? undefined
      : draft
        ? {
            dateYmd: draft.dateYmd,
            hours: draft.hours,
            description: draft.description,
            evidenceUrls: evidenceValidated.length ? evidenceValidated : draft.evidenceUrls,
            taskLabel: draft.taskLabel,
            transportLabel: draft.transportLabel,
            areaProjectLabel: draft.areaProjectLabel,
          }
        : undefined;

  // Hash incluye TODAS las afirmaciones materiales (no solo campos editables sueltos).
  const payload = {
    op: input.op,
    dateYmd: input.dateYmd,
    reportId: input.reportId ?? null,
    publicUrl: RIPOR_PUBLIC_URL,
    profile: input.profile,
    draft: draft
      ? {
          dateYmd: draft.dateYmd,
          areaProjectLabel: draft.areaProjectLabel,
          taskLabel: draft.taskLabel,
          hours: draft.hours,
          description: draft.description,
          evidenceUrls: evidenceValidated.length ? evidenceValidated : [...draft.evidenceUrls].sort(),
          transportLabel: draft.transportLabel,
          transportIsDailyOverride: draft.transportIsDailyOverride,
          explicitUnderHoursRequest: draft.explicitUnderHoursRequest
            ? {
                dateYmd: draft.explicitUnderHoursRequest.dateYmd,
                hours: draft.explicitUnderHoursRequest.hours,
                reason: draft.explicitUnderHoursRequest.reason ?? null,
              }
            : null,
          skipDay: draft.skipDay ?? false,
        }
      : null,
    existingSameDay: input.existingSameDay
      .map((r) => ({ ...r }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    before: before
      ? { ...before }
      : null,
    coverageProof: input.coverageProof
      ? {
          sustainedActivityHours: input.coverageProof.sustainedActivityHours,
          coversDraftDedication: input.coverageProof.coversDraftDedication,
          source: input.coverageProof.source,
        }
      : input.sustainedActivityHours !== undefined && input.activitiesCoverFullDay === true
        ? {
            sustainedActivityHours: input.sustainedActivityHours,
            coversDraftDedication: true as const,
            source: "azure_confirmed" as const,
            legacyMapped: true,
          }
        : null,
    activitiesCoverFullDay: input.activitiesCoverFullDay ?? null,
    affirmations: {
      proposedTotalHours: policy.proposedTotalHours,
      expectedHoursForDay: policy.expectedHoursForDay,
      existingHoursSameDay: policy.existingHoursSameDay,
      policyOk: policy.ok,
      blockerCount: policy.blockers.length,
    },
  };

  const snapshotHash = riporSnapshotHash(payload);

  const policyNotes = [
    ...policy.notes,
    ...policy.decisions,
    `Ventana laboral (informativa): ${workWindowLabel(input.dateYmd, input.profile.schedule)}`,
    `URL pública: ${RIPOR_PUBLIC_URL}`,
  ];

  const blockers = [...policy.blockers];
  if (input.op === "update" && !input.reportId) {
    blockers.push("Update requiere reportId y preview before/after.");
  }
  if (input.op === "delete" && !input.reportId) {
    blockers.push("Delete requiere reportId (fecha+id).");
  }

  return {
    op: input.op,
    dateYmd: input.dateYmd,
    publicUrl: RIPOR_PUBLIC_URL,
    fields: draft,
    before,
    after,
    reportId: input.reportId,
    existingHoursSameDay: policy.existingHoursSameDay,
    proposedTotalHours: policy.proposedTotalHours,
    expectedHoursForDay: policy.expectedHoursForDay,
    snapshotHash,
    policyNotes,
    blockers,
    coverageProof: input.coverageProof
      ?? (input.sustainedActivityHours !== undefined && input.activitiesCoverFullDay === true
        ? {
            sustainedActivityHours: input.sustainedActivityHours,
            coversDraftDedication: true as const,
            source: "azure_confirmed" as const,
          }
        : undefined),
    activitiesCoverFullDay: input.activitiesCoverFullDay,
  };
}

export function assertRiporApproval(
  preview: RiporPreview,
  approval: RiporApproval,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (approval.op !== preview.op) errors.push(`op mismatch: approval=${approval.op} preview=${preview.op}`);
  if (approval.dateYmd !== preview.dateYmd) {
    errors.push(`date mismatch: approval=${approval.dateYmd} preview=${preview.dateYmd}`);
  }
  if (approval.snapshotHash !== preview.snapshotHash) {
    errors.push("snapshotHash mismatch: re-preview required (preview caducado o alterado).");
  }
  if (preview.op === "delete") {
    if (!approval.deleteConfirmed) {
      errors.push("Delete requiere confirmación separada (deleteConfirmed=true).");
    }
    if (!approval.reportId || approval.reportId !== preview.reportId) {
      errors.push("Delete approval debe citar el mismo reportId del preview.");
    }
  }
  if (preview.op === "update") {
    if (!approval.reportId || approval.reportId !== preview.reportId) {
      errors.push("Update approval debe citar el mismo reportId.");
    }
  }
  if (preview.blockers.length) {
    errors.push(`Preview bloqueado: ${preview.blockers.join("; ")}`);
  }
  return { ok: errors.length === 0, errors };
}
