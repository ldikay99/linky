import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockRiporUiAdapter, createUnimplementedRiporAdapter } from "../agent/lib/browser/adapter.js";
import { buildRiporPreview, assertRiporApproval } from "../agent/lib/ripor/preview.js";
import { applyRiporMutation, previewRiporMutation } from "../agent/lib/ripor/apply.js";
import { buildRiporProfileFromSetup } from "../agent/lib/ripor/setup.js";
import type { RiporCoverageProof, RiporDraftFields } from "../agent/lib/ripor/types.js";
import { RIPOR_UI_OBSERVATIONS } from "../agent/lib/ripor/uiObservations.js";

const cov = (h = 8.5): RiporCoverageProof => ({
  sustainedActivityHours: h,
  coversDraftDedication: true,
  source: "azure_confirmed",
});

async function readyProfile() {
  const r = buildRiporProfileFromSetup({
    uiObserved: true,
    uiAreaProjects: [{ label: "[MOCK] Área", verifiedFromUi: false }],
    chosenAreaProjectLabel: "[MOCK] Área",
    uiTransportOptions: [{ label: "🏠 Trabajo Remoto", verifiedFromUi: true }],
    chosenTransportLabel: "🏠 Trabajo Remoto",
    azureProjectHints: ["Example"],
  });
  if (!r.profile) throw new Error("setup failed");
  return r.profile;
}

function draft(over: Partial<RiporDraftFields> = {}): RiporDraftFields {
  return {
    dateYmd: "2026-11-05",
    areaProjectLabel: "[MOCK] Área",
    taskLabel: RIPOR_UI_OBSERVATIONS.form.taskDefaultLabelObserved,
    hours: 8.5,
    description: "Actividades Azure confirmadas del día (test).",
    evidenceUrls: ["https://github.com/example/repo"],
    transportLabel: "🏠 Trabajo Remoto",
    transportIsDailyOverride: false,
    ...over,
  };
}

describe("ripor preview/apply adversarial", () => {
  it("create with proof: hash stable; tampering evidence changes hash", async () => {
    const profile = await readyProfile();
    const existing: [] = [];
    const p1 = buildRiporPreview({
      op: "create",
      dateYmd: "2026-11-05",
      draft: draft(),
      existingSameDay: existing,
      profile,
      coverageProof: cov(8.5),
      activitiesCoverFullDay: true,
    });
    expect(p1.blockers).toEqual([]);
    const p2 = buildRiporPreview({
      op: "create",
      dateYmd: "2026-11-05",
      draft: draft({ evidenceUrls: ["https://github.com/example/OTHER"] }),
      existingSameDay: existing,
      profile,
      coverageProof: cov(8.5),
      activitiesCoverFullDay: true,
    });
    expect(p1.snapshotHash).not.toBe(p2.snapshotHash);
  });

  it("hash includes coverageProof — flipping sustained invalidates approval", async () => {
    const profile = await readyProfile();
    const p1 = buildRiporPreview({
      op: "create",
      dateYmd: "2026-11-05",
      draft: draft(),
      existingSameDay: [],
      profile,
      coverageProof: cov(8.5),
      activitiesCoverFullDay: true,
    });
    const p2 = buildRiporPreview({
      op: "create",
      dateYmd: "2026-11-05",
      draft: draft(),
      existingSameDay: [],
      profile,
      coverageProof: cov(9),
      activitiesCoverFullDay: true,
    });
    expect(p1.snapshotHash).not.toBe(p2.snapshotHash);
    expect(
      assertRiporApproval(p2, {
        op: "create",
        dateYmd: "2026-11-05",
        snapshotHash: p1.snapshotHash,
      }).ok,
    ).toBe(false);
  });

  it("editable flag alone does not approve", async () => {
    const profile = await readyProfile();
    const p = buildRiporPreview({
      op: "create",
      dateYmd: "2026-11-05",
      draft: draft(),
      existingSameDay: [],
      profile,
      activitiesCoverFullDay: true,
    });
    expect(p.blockers.length).toBeGreaterThan(0);
  });

  it("create preview+apply mock with proof", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-ripor-"));
    const profile = await readyProfile();
    const adapter = createMockRiporUiAdapter();
    const preview = await previewRiporMutation({
      adapter,
      profile,
      op: "create",
      dateYmd: "2026-11-05",
      draft: draft(),
      coverageProof: cov(8.5),
      activitiesCoverFullDay: true,
    });
    expect(preview.blockers).toEqual([]);
    const result = await applyRiporMutation({
      adapter,
      profile,
      op: "create",
      dateYmd: "2026-11-05",
      draft: draft(),
      approval: { op: "create", dateYmd: "2026-11-05", snapshotHash: preview.snapshotHash },
      coverageProof: cov(8.5),
      activitiesCoverFullDay: true,
      dataDir,
    });
    expect(result.ok).toBe(true);
  });

  it("update requires existing target + before/after", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-ripor-u-"));
    const profile = await readyProfile();
    const adapter = createMockRiporUiAdapter({
      existing: { "2026-11-05": [{ id: "mock-1", hours: 8.5, summary: "old" }] },
    });
    const preview = buildRiporPreview({
      op: "update",
      dateYmd: "2026-11-05",
      draft: draft({ description: "Corregido." }),
      existingSameDay: [{ id: "mock-1", dateYmd: "2026-11-05", hours: 8.5, description: "old" }],
      profile,
      reportId: "mock-1",
      coverageProof: cov(8.5),
      activitiesCoverFullDay: true,
    });
    expect(preview.before?.id).toBe("mock-1");
    const result = await applyRiporMutation({
      adapter,
      profile,
      op: "update",
      dateYmd: "2026-11-05",
      draft: draft({ description: "Corregido." }),
      reportId: "mock-1",
      approval: {
        op: "update",
        dateYmd: "2026-11-05",
        snapshotHash: preview.snapshotHash,
        reportId: "mock-1",
      },
      coverageProof: cov(8.5),
      activitiesCoverFullDay: true,
      dataDir,
    });
    expect(result.ok).toBe(true);
  });

  it("delete needs separate confirmation; missing confirm fails", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-ripor-d-"));
    const profile = await readyProfile();
    const adapter = createMockRiporUiAdapter({
      existing: { "2026-11-05": [{ id: "mock-9", hours: 8.5 }] },
    });
    const preview = await previewRiporMutation({
      adapter,
      profile,
      op: "delete",
      dateYmd: "2026-11-05",
      reportId: "mock-9",
    });
    const noConfirm = await applyRiporMutation({
      adapter,
      profile,
      op: "delete",
      dateYmd: "2026-11-05",
      reportId: "mock-9",
      approval: {
        op: "delete",
        dateYmd: "2026-11-05",
        snapshotHash: preview.snapshotHash,
        reportId: "mock-9",
        deleteConfirmed: false,
      },
      dataDir,
    });
    expect(noConfirm.ok).toBe(false);

    const preview2 = await previewRiporMutation({
      adapter,
      profile,
      op: "delete",
      dateYmd: "2026-11-05",
      reportId: "mock-9",
    });
    const ok = await applyRiporMutation({
      adapter,
      profile,
      op: "delete",
      dateYmd: "2026-11-05",
      reportId: "mock-9",
      approval: {
        op: "delete",
        dateYmd: "2026-11-05",
        snapshotHash: preview2.snapshotHash,
        reportId: "mock-9",
        deleteConfirmed: true,
      },
      dataDir,
    });
    expect(ok.ok).toBe(true);
  });

  it("unimplemented adapter not production; UI observations not claiming headless", () => {
    const a = createUnimplementedRiporAdapter();
    expect(a.kind).toBe("unimplemented");
    expect(a.capabilities.headlessReuseSupported).toBe(false);
    expect(RIPOR_UI_OBSERVATIONS.session.headlessReuseValidated).toBe(false);
    expect(RIPOR_UI_OBSERVATIONS.session.productionAdapterVerified).toBe(false);
    expect(RIPOR_UI_OBSERVATIONS.form.taskDefaultLabelObserved).toBe("Tarea Personalizada");
  });
});
