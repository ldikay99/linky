import { describe, expect, it } from "vitest";
import { createMockAzureClient } from "../agent/lib/azure/client.js";
import { createEmptyProfile } from "../agent/lib/profile/store.js";
import { previewDayChanges } from "../agent/lib/apply/preview.js";
import { applyPreview } from "../agent/lib/apply/apply.js";
import { resolveTargetState, isClosedLikeState } from "../agent/lib/azure/states.js";
import type { ProcessMeta } from "../agent/lib/types.js";
import { buildDayPlan } from "../agent/lib/planning/day.js";

function profileBase() {
  return createEmptyProfile({
    azure: { organizationUrl: "https://dev.azure.com/ExampleOrg", project: "Example Project", defaultTags: [] },
    workContext: { occupation: "Ingeniero de datos", projectContext: "Pipelines y reportes sintéticos de demo" },
    responsibility: { assignedDisplayName: "Persona Demo", responsibleTag: "RESPONSABLE-DEMO" },
    huCreation: "scrum_or_third_party_only",
    taskClose: "ask_each_time",
    huClose: "scrum_or_third_party",
  });
}

describe("close never automatic", () => {
  it("localiza Closed/Completed/4.Cerrado como close-like", () => {
    expect(isClosedLikeState({ name: "Closed" })).toBe(true);
    expect(isClosedLikeState({ name: "Completed" })).toBe(true);
    expect(isClosedLikeState({ name: "4.Cerrado" })).toBe(true);
    expect(isClosedLikeState({ name: "Entregado" })).toBe(false);
  });

  it("resolve entregado no elige Completed/Closed", () => {
    const meta: ProcessMeta = {
      workItemType: "Task",
      fields: [],
      states: [
        { name: "To Do" },
        { name: "In Progress" },
        { name: "Entregado" },
        { name: "Completed", category: "Completed" },
        { name: "Closed", category: "Completed" },
        { name: "4.Cerrado", category: "Completed" },
      ],
      transitions: [],
    };
    const r = resolveTargetState(meta, "entregado");
    expect(r.state).toBe("Entregado");
    expect(r.isCloseLike).toBe(false);
  });

  it("preview no cierra sin intención+aprobación separada; apply bloquea bypass", async () => {
    const { client, state } = createMockAzureClient();
    const seeded = await client.createWorkItem("Task", [
      { op: "add", path: "/fields/System.Title", value: "T" },
      { op: "add", path: "/fields/System.State", value: "Entregado" },
    ]);
    const profile = profileBase();
    profile.processCache = state.types;
    // force localized closed states into Task meta
    profile.processCache!.Task.states.push(
      { name: "Closed", category: "Completed" },
      { name: "4.Cerrado", category: "Completed" },
    );

    const plan = buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          id: "act-1",
          kind: "done",
          title: "T",
          shortDescription: "Terminé la validación del export sintético.",
          workItemId: seeded.id,
          parentHuId: 1,
          workItemType: "Task",
          minutesSpent: 30,
          evidenceLinks: ["https://example.com/e/1"],
          timeRange: { start: "09:00", end: "09:30" },
        },
      ],
    });
    // clear coverage questions for this unit by accepting gaps as warnings only - may still miss full day coverage
    const planLoose = { ...plan, missingQuestions: plan.missingQuestions.filter((q) => !/Hueco|timeRange|cobertura/i.test(q)) };

    const previewNoClose = await previewDayChanges(profile, planLoose, client, {
      intents: { "act-1": "cerrado" },
    });
    expect(previewNoClose.changes.some((c) => c.op === "transition" && c.intent === "cerrado")).toBe(false);

    const previewClose = await previewDayChanges(profile, planLoose, client, {
      intents: { "act-1": "cerrado" },
      userExplicitCloseIntentIds: ["act-1"],
      explicitCloseApprovedIds: ["act-1"],
    });
    const closeChange = previewClose.changes.find((c) => c.op === "transition" && c.intent === "cerrado");
    expect(closeChange).toBeTruthy();

    // Bypass: strip flags and try apply — must block
    const bypass = {
      ...previewClose,
      changes: previewClose.changes.map((c) =>
        c.op === "transition" && c.intent === "cerrado"
          ? { ...c, userExplicitCloseIntent: false, explicitCloseApproved: false }
          : c,
      ),
      snapshotHash: "",
    };
    const { hashPreviewSnapshot } = await import("../agent/lib/apply/idempotency.js");
    bypass.snapshotHash = hashPreviewSnapshot(bypass);
    const dataDir = await (await import("node:fs/promises")).mkdtemp(
      (await import("node:path")).join((await import("node:os")).tmpdir(), "linky-close-"),
    );
    const result = await applyPreview(
      client,
      bypass,
      { approved: true, approvedBy: "x", approvedSnapshotHash: bypass.snapshotHash },
      { dataDir, profile },
    );
    expect(result.blocked.some((b) => /intención EXPLÍCITA|SEPARADA/i.test(b.reason))).toBe(true);
  });
});
