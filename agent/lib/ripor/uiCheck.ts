import { riporSnapshotHash } from "./hash.js";
import { buildRiporPreview, assertRiporApproval } from "./preview.js";
import type { RiporProfile, RiporExistingReport, RiporDraftFields, RiporCoverageProof, RiporApproval } from "./types.js";

/** Local observation supplied by the AI from a fresh PUBLIC UI snapshot.
 * These are reviewable assertions, not cryptographic proof of a website or hours worked.
 * This module never reads the browser, calls APIs, or performs a mutation.
 */
export type UiCheckInput = {
  op: "create" | "update" | "delete";
  dateYmd: string;
  reportId?: string;
  draft?: RiporDraftFields;
  coverageProof?: RiporCoverageProof;
  activitiesCoverFullDay?: boolean;
  observation: {
    source: "ui_snapshot";
    dateYmd: string;
    /** All rows for date, across pages/filters; false/unknown must block. */
    complete: boolean;
    reports: RiporExistingReport[];
    areaProjects: string[];
    tasks: string[];
    transports: string[];
  };
};

export function checkObservedRipor(input: UiCheckInput, profile: RiporProfile) {
  const preview = buildRiporPreview({
    ...input, profile, existingSameDay: input.observation.reports,
  });
  if (input.observation.source !== "ui_snapshot" || input.observation.complete !== true || input.observation.dateYmd !== input.dateYmd) {
    preview.blockers.push("Complete dated UI observation required; missing rows cannot mean an empty day.");
  }
  if (!profile.setupComplete) preview.blockers.push("Setup incomplete.");
  if (input.draft && input.op !== "delete") {
    if (!input.observation.areaProjects.includes(input.draft.areaProjectLabel)) preview.blockers.push("Area project not observed in UI options.");
    if (!input.observation.tasks.includes(input.draft.taskLabel)) preview.blockers.push("Task not observed in UI options.");
    if (!input.observation.transports.includes(input.draft.transportLabel)) preview.blockers.push("Transport not observed in UI options.");
  }
  preview.snapshotHash = riporSnapshotHash({ core: preview.snapshotHash, observation: input.observation, profile });
  return preview;
}

/** Recompute from a NEW observation before a guided UI save. No browser call, no write. */
export function gateObservedRipor(input: UiCheckInput, profile: RiporProfile, approval: RiporApproval) {
  const preview = checkObservedRipor(input, profile);
  const decision = assertRiporApproval(preview, approval);
  return { ...decision, preview, mutationPerformed: false as const, message: "Validation only. Actual UI action requires human/AI host approval and subsequent UI reconciliation." };
}
