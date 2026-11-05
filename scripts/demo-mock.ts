/**
 * Demo local end-to-end con mock (sin Azure real, sin IA pagada).
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockAzureClient } from "../agent/lib/azure/client.js";
import { runOnboarding } from "../agent/lib/onboarding/wizard.js";
import { buildDayPlan } from "../agent/lib/planning/day.js";
import { previewDayChanges } from "../agent/lib/apply/preview.js";
import { applyPreview } from "../agent/lib/apply/apply.js";
import { writeDayMessageDrafts } from "../agent/lib/messaging/drafts.js";
import { loadProfile } from "../agent/lib/profile/store.js";
import { createFakeSecretStore } from "../agent/lib/security/secretStore.js";

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "linky-demo-"));
  const fakeSecrets = createFakeSecretStore();
  const { client, state } = createMockAzureClient();
  const hu = await client.createWorkItem("User Story", [
    { op: "add", path: "/fields/System.Title", value: "HU seed" },
  ]);
  await client.createWorkItem("Task", [
    { op: "add", path: "/fields/System.Title", value: "Seed" },
    { op: "add", path: "/fields/System.State", value: "In Progress" },
  ]);

  await runOnboarding(
    {
      organizationUrl: "https://dev.azure.com/ExampleOrg",
      project: "Example Project",
      occupation: "Ingeniero de datos",
      projectContext: "Demo pipelines sintéticos",
      assignedDisplayName: "Persona Demo",
      responsibleTag: "DEMO-TAG",
      lunchMinutes: 60,
      confirmScheduleInterpretation: true,
      pat: "synthetic-pat-not-real-demo",
      patCreatedOn: "2026-10-01",
      patExpiresOn: "2027-06-01",
      deviceTimeZone: "America/Bogota",
      confirmDeviceTimeZone: true,
      scopeChoice: "work_items_rw",
      defaultTags: ["DEMO TAG"],
      huCreation: "scrum_or_third_party_only",
      taskDelivery: "same_user",
      taskClose: "ask_each_time",
      huClose: "scrum_or_third_party",
    },
    { dataDir, createClient: () => client, secretStore: fakeSecrets, nowMs: Date.parse("2026-11-05T15:00:00.000Z") },
  );

  const profile = (await loadProfile(dataDir))!;
  const existingId = [...state.items.keys()][0]!;
  const plan = buildDayPlan(profile, {
    date: "2026-11-05",
    activities: [
      {
        id: "act-1",
        kind: "done",
        title: "Seed update",
        shortDescription: "Actualicé la task seed con evidencia de prueba.",
        workItemId: existingId,
        parentHuId: hu.id,
        workItemType: "Task",
        minutesSpent: 45,
        evidenceLinks: ["https://example.com/commit/1"],
        timeRange: { start: "09:00", end: "09:45" },
      },
      {
        id: "act-2",
        kind: "planned",
        title: "Nueva task",
        shortDescription: "Crearé checklist de QA para el handoff.",
        workItemType: "Task",
        parentHuId: hu.id,
        minutesEstimate: 60,
        estimateMarginApproved: true,
      },
    ],
  });

  // Demo: no inventar cobertura total; filtrar solo huecos de jornada para ejercitar apply
  const planForPreview = {
    ...plan,
    missingQuestions: plan.missingQuestions.filter((q) => !/Hueco|timeRange|cobertura/i.test(q)),
  };
  const preview = await previewDayChanges(profile, planForPreview, client, {
    intents: { "act-1": "entregado" },
  });
  const applied = await applyPreview(
    client,
    preview,
    { approved: true, approvedBy: "demo-user", approvedSnapshotHash: preview.snapshotHash },
    { dataDir, profile },
  );
  const drafts = await writeDayMessageDrafts(profile, plan, dataDir);
  const out = {
    dataDir,
    planMissing: plan.missingQuestions,
    previewSummary: preview.humanSummary,
    snapshotHash: preview.snapshotHash,
    applied,
    drafts: drafts.map((d) => ({ kind: d.kind, filePath: d.filePath })),
    itemCount: state.items.size,
    secretDumpHasPat: Object.values(fakeSecrets.dump()).some((v) => v.includes("synthetic-pat")),
    profileHasPat: JSON.stringify(profile).includes("synthetic-pat"),
  };
  await writeFile(path.join(dataDir, "demo-report.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
