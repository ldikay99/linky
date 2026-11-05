import type { RiporUiAdapter } from "../browser/adapter.js";
import {
  appendRiporJournal,
  loadRiporJournal,
  reconcileRiporJournalEntry,
  riporJournalBlocksMutations,
} from "./journal.js";
import { assertRiporApproval, buildRiporPreview } from "./preview.js";
import { evaluateRiporPolicy } from "./policy.js";
import type {
  RiporApproval,
  RiporDraftFields,
  RiporExistingReport,
  RiporPreview,
  RiporProfile,
} from "./types.js";

export type RiporApplyResult = {
  ok: boolean;
  preview: RiporPreview;
  journalId?: string;
  reportId?: string;
  message: string;
  errors: string[];
};

/**
 * Apply con preview hash + aprobación específica.
 * Revalida políticas; journal fail-closed; no repetir guardar si UI incierta.
 * Vía adapter: HTTP (formulario web con la sesión del usuario), mock o Playwright del host.
 */
export async function applyRiporMutation(input: {
  adapter: RiporUiAdapter;
  profile: RiporProfile;
  op: "create" | "update" | "delete";
  dateYmd: string;
  draft?: RiporDraftFields;
  reportId?: string;
  approval: RiporApproval;
  activitiesCoverFullDay?: boolean;
  sustainedActivityHours?: number;
  coverageProof?: import("./types.js").RiporCoverageProof;
  dataDir?: string;
  /** Si true, no llama adapter.apply (solo valida) */
  dryRun?: boolean;
}): Promise<RiporApplyResult> {
  const errors: string[] = [];

  if (!input.profile.setupComplete || !input.profile.areaProject) {
    return {
      ok: false,
      preview: buildRiporPreview({
        op: input.op,
        dateYmd: input.dateYmd,
        draft: input.draft,
        existingSameDay: [],
        profile: input.profile,
        reportId: input.reportId,
      }),
      message: "Setup Ripor incompleto.",
      errors: ["Completar setup: proyecto de área + transporte desde opciones UI."],
    };
  }

  const journal = await loadRiporJournal(input.dataDir);
  const block = riporJournalBlocksMutations(journal);
  if (block.blocked) {
    return {
      ok: false,
      preview: buildRiporPreview({
        op: input.op,
        dateYmd: input.dateYmd,
        draft: input.draft,
        existingSameDay: [],
        profile: input.profile,
        reportId: input.reportId,
      }),
      message: block.reason ?? "Journal bloqueado",
      errors: [block.reason ?? "journal blocked"],
    };
  }

  let existingRaw: Array<{ id: string; dateYmd: string; hours: number; summary?: string }> = [];
  try {
    existingRaw = await input.adapter.listReportsForDate(input.dateYmd);
  } catch (e) {
    return {
      ok: false,
      preview: buildRiporPreview({
        op: input.op,
        dateYmd: input.dateYmd,
        draft: input.draft,
        existingSameDay: [],
        profile: input.profile,
        reportId: input.reportId,
      }),
      message: "UI incierta al listar reportes (fail-closed).",
      errors: [String((e as Error).message || e)],
    };
  }

  const existingSameDay: RiporExistingReport[] = existingRaw.map((r) => ({
    id: r.id,
    dateYmd: r.dateYmd,
    hours: r.hours,
    description: r.summary,
  }));

  const preview = buildRiporPreview({
    op: input.op,
    dateYmd: input.dateYmd,
    draft: input.draft,
    existingSameDay,
    profile: input.profile,
    reportId: input.reportId,
    activitiesCoverFullDay: input.activitiesCoverFullDay,
    sustainedActivityHours: input.sustainedActivityHours,
    coverageProof: input.coverageProof,
  });

  const approved = assertRiporApproval(preview, input.approval);
  if (!approved.ok) {
    return { ok: false, preview, message: "Aprobación inválida", errors: approved.errors };
  }

  // Revalidar políticas justo antes de mutar
  const policy = evaluateRiporPolicy({
    op: input.op,
    dateYmd: input.dateYmd,
    draft: input.draft,
    existingSameDay,
    profile: input.profile,
    reportId: input.reportId,
    activitiesCoverFullDay: input.activitiesCoverFullDay,
    sustainedActivityHours: input.sustainedActivityHours,
    coverageProof: input.coverageProof,
  });
  if (!policy.ok) {
    return { ok: false, preview, message: "Política falló en revalidación", errors: policy.blockers };
  }

  if (input.dryRun) {
    return { ok: true, preview, message: "Dry-run OK (sin mutar UI)", errors: [] };
  }

  const pending = await appendRiporJournal(
    {
      op: input.op,
      dateYmd: input.dateYmd,
      status: "pending",
      snapshotHash: preview.snapshotHash,
      reportId: input.reportId,
      message: "apply started",
    },
    input.dataDir,
  );

  let result: { ok: boolean; message: string; reportId?: string };
  try {
    const fields: Record<string, string> = {};
    if (input.draft) {
      fields.hours = String(input.draft.hours);
      fields.notes = input.draft.description;
      fields.evidencia = input.draft.evidenceUrls.join(" ");
      fields.medio_transporte = input.draft.transportLabel;
      fields.task_label = input.draft.taskLabel;
      fields.project_label = input.draft.areaProjectLabel;
      fields.date = input.draft.dateYmd;
    }
    result = await input.adapter.applyUiAction({
      op: input.op,
      dateYmd: input.dateYmd,
      reportId: input.reportId,
      fields,
    });
  } catch (e) {
    await reconcileRiporJournalEntry(
      pending.id,
      "unknown",
      `UI error (no reintentar ciegamente): ${String((e as Error).message || e)}`,
      input.dataDir,
    );
    return {
      ok: false,
      preview,
      journalId: pending.id,
      message: "UI incierta tras intento — journal=unknown; reconciliar antes de repetir.",
      errors: [String((e as Error).message || e)],
    };
  }

  if (!result.ok) {
    const uncertain = /incerta|uncertain|pending|FAIL_CLOSED/i.test(result.message);
    await reconcileRiporJournalEntry(
      pending.id,
      uncertain ? "unknown" : "failed",
      result.message,
      input.dataDir,
    );
    return {
      ok: false,
      preview,
      journalId: pending.id,
      message: result.message,
      errors: [result.message],
    };
  }

  await reconcileRiporJournalEntry(pending.id, "ok", result.message, input.dataDir);
  return {
    ok: true,
    preview,
    journalId: pending.id,
    reportId: result.reportId ?? input.reportId,
    message: result.message,
    errors: [],
  };
}

/** Solo preview (sin apply). */
export async function previewRiporMutation(input: {
  adapter: RiporUiAdapter;
  profile: RiporProfile;
  op: "create" | "update" | "delete";
  dateYmd: string;
  draft?: RiporDraftFields;
  reportId?: string;
  activitiesCoverFullDay?: boolean;
  sustainedActivityHours?: number;
  coverageProof?: import("./types.js").RiporCoverageProof;
}): Promise<RiporPreview> {
  let existingSameDay: RiporExistingReport[] = [];
  let observationFailed = false;
  try {
    const raw = await input.adapter.listReportsForDate(input.dateYmd);
    existingSameDay = raw.map((r) => ({
      id: r.id,
      dateYmd: r.dateYmd,
      hours: r.hours,
      description: r.summary,
    }));
  } catch {
    observationFailed = true;
    existingSameDay = [];
  }
  const preview = buildRiporPreview({
    op: input.op,
    dateYmd: input.dateYmd,
    draft: input.draft,
    existingSameDay,
    profile: input.profile,
    reportId: input.reportId,
    activitiesCoverFullDay: input.activitiesCoverFullDay,
    sustainedActivityHours: input.sustainedActivityHours,
    coverageProof: input.coverageProof,
  });
  if (observationFailed) preview.blockers.push("UI observation failed: existing reports unknown, NOT an empty day. Live preview blocked.");
  if (existingSameDay.length === 0 && input.op !== "create") {
    preview.blockers.push("No se pudieron listar reportes existentes o lista vacía para update/delete.");
  }
  return preview;
}
