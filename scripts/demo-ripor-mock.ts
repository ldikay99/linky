/**
 * Demo Ripor offline (mock). No red, no cookies, no reportes reales.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockRiporUiAdapter } from "../agent/lib/browser/adapter.js";
import { buildRiporProfileFromSetup } from "../agent/lib/ripor/setup.js";
import { saveRiporProfile } from "../agent/lib/ripor/profileStore.js";
import { previewRiporMutation, applyRiporMutation } from "../agent/lib/ripor/apply.js";
import { buildRiporDailyDescription } from "../agent/lib/ripor/description.js";
import { RIPOR_PUBLIC_URL } from "../agent/lib/ripor/types.js";

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "linky-ripor-demo-"));
  const setup = buildRiporProfileFromSetup({
    uiObserved: false,
    uiAreaProjects: [{ label: "[MOCK no verificado] Área Demo A", verifiedFromUi: false }],
    chosenAreaProjectLabel: "[MOCK no verificado] Área Demo A",
    uiTransportOptions: [{ label: "🏠 Trabajo Remoto", verifiedFromUi: false }],
    chosenTransportLabel: "🏠 Trabajo Remoto",
    azureProjectHints: ["Example Project"],
  });
  if (!setup.profile) throw new Error(setup.errors.join("; "));
  await saveRiporProfile(setup.profile, dataDir);

  const desc = buildRiporDailyDescription([
    {
      title: "ControlDB security",
      doneSummary: "Se avanzó en mejoras de seguridad confirmadas en Azure (sintético).",
      projectHint: "Example Project",
    },
  ]);

  const adapter = createMockRiporUiAdapter();
  const draft = {
    dateYmd: "2026-11-05",
    areaProjectLabel: "[MOCK no verificado] Área Demo A",
    taskLabel: "Tarea Personalizada",
    hours: 8.5,
    description: desc.description,
    evidenceUrls: ["https://github.com/example/ControlDB-synthetic"],
    transportLabel: "🏠 Trabajo Remoto",
    transportIsDailyOverride: false,
  };

  const coverageProof = {
    sustainedActivityHours: 8.5,
    coversDraftDedication: true as const,
    source: "azure_confirmed" as const,
  };

  const preview = await previewRiporMutation({
    adapter,
    profile: setup.profile,
    op: "create",
    dateYmd: "2026-11-05",
    draft,
    activitiesCoverFullDay: true,
    sustainedActivityHours: 8.5,
    coverageProof,
  });

  const applied = await applyRiporMutation({
    adapter,
    profile: setup.profile,
    op: "create",
    dateYmd: "2026-11-05",
    draft,
    approval: {
      op: "create",
      dateYmd: "2026-11-05",
      snapshotHash: preview.snapshotHash,
    },
    activitiesCoverFullDay: true,
    sustainedActivityHours: 8.5,
    coverageProof,
    dataDir,
  });

  console.log(
    JSON.stringify(
      {
        publicUrl: RIPOR_PUBLIC_URL,
        dataDir,
        previewHash: preview.snapshotHash,
        blockers: preview.blockers,
        appliedOk: applied.ok,
        reportId: applied.reportId,
        listed: await adapter.listReportsForDate("2026-11-05"),
        note: "Mock only — no real Ripor mutation. Manual UI cycle separately observed by parent; this demo does NOT test live selectors or headless.",
        capabilities: adapter.capabilities,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(String((e as Error).message || e));
  process.exit(1);
});
