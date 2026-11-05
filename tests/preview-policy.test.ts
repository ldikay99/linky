import { describe, expect, it } from "vitest";
import { createMockAzureClient } from "../agent/lib/azure/client.js";
import { createEmptyProfile } from "../agent/lib/profile/store.js";
import { buildDayPlan } from "../agent/lib/planning/day.js";
import { previewDayChanges } from "../agent/lib/apply/preview.js";

describe("preview policies", () => {
  it("no crea HU bajo política scrum; sí crea Task bajo HU leída", async () => {
    const { client, state } = createMockAzureClient();
    const hu = await client.createWorkItem("User Story", [
      { op: "add", path: "/fields/System.Title", value: "HU padre" },
    ]);
    const profile = createEmptyProfile({
      azure: { organizationUrl: "https://dev.azure.com/ExampleOrg", project: "Example Project", defaultTags: [] },
      workContext: { occupation: "Ingeniero de datos", projectContext: "Demo pipelines sintéticos" },
      responsibility: { assignedDisplayName: "Persona Demo", responsibleTag: "DEMO-TAG" },
      huCreation: "scrum_or_third_party_only",
      processCache: state.types,
      schedule: {
        timezone: "America/Bogota",
        mondayToThursday: { start: "08:30", end: "18:00" },
        friday: { start: "08:00", end: "17:00" },
        lunchAsked: true,
        lunchMinutes: 60,
        lunchStart: "12:00",
        lunchEnd: "13:00",
        scheduleInterpretationConfirmed: true,
        holidays: [],
        absences: [],
      },
    });
    const plan2 = buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          kind: "done",
          title: "Task hija",
          shortDescription: "Terminé la integración del export.",
          workItemType: "Task",
          parentHuId: hu.id,
          minutesSpent: 30,
          evidenceLinks: ["https://example.com/pr/1"],
          timeRange: { start: "09:00", end: "09:30" },
        },
      ],
    });
    // Solo nos importan faltantes de negocio distintos de cobertura total del día
    const filtered = {
      ...plan2,
      missingQuestions: plan2.missingQuestions.filter((q) => !/Hueco|cobertura/i.test(q)),
    };
    expect(filtered.missingQuestions).toEqual([]);
    const preview = await previewDayChanges(profile, filtered, client, {});
    expect(preview.snapshotHash.length).toBe(64);
    expect(preview.changes.some((c) => c.op === "create")).toBe(true);

    const planHu = buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          kind: "planned",
          title: "HU nueva",
          shortDescription: "Definiré alcance con producto.",
          workItemType: "User Story",
        },
      ],
    });
    const previewHu = await previewDayChanges(
      profile,
      { ...planHu, missingQuestions: [] },
      client,
      { allowHuCreate: false },
    );
    expect(previewHu.changes.some((c) => c.op === "create")).toBe(false);
  });
});
