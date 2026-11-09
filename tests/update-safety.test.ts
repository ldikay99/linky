import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyPreview, reconcileClientKey } from "../agent/lib/apply/apply.js";
import { previewDayChanges } from "../agent/lib/apply/preview.js";
import { beginPending, isUncertainError, markUnknown } from "../agent/lib/apply/idempotency.js";
import { createMockAzureClient } from "../agent/lib/azure/client.js";
import { buildDayPlan } from "../agent/lib/planning/day.js";
import { createEmptyProfile } from "../agent/lib/profile/store.js";

async function setup() {
  const { client, state } = createMockAzureClient();
  const task = await client.createWorkItem("Task", [
    { op: "add", path: "/fields/System.Title", value: "Task existente" },
    { op: "add", path: "/fields/System.Description", value: "<p>Criterios de aceptación originales</p>" },
    { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.CompletedWork", value: 10 },
  ]);
  const profile = createEmptyProfile({
    azure: { organizationUrl: "https://dev.azure.com/ExampleOrg", project: "Example Project", defaultTags: [] },
    workContext: { occupation: "Analista", projectContext: "Demo" },
    responsibility: { assignedDisplayName: "Persona Demo" },
    processCache: state.types,
  });
  const plan = (minutes: number) =>
    buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          kind: "done",
          title: "Task existente",
          shortDescription: "Ajusté el informe y validé los totales con el equipo.",
          workItemType: "Task",
          workItemId: task.id,
          minutesSpent: minutes,
          evidenceLinks: ["https://example.com/doc/1"],
        },
      ],
    });
  return { client, state, task, profile, plan };
}

describe("actualizar un item existente sin perder datos", () => {
  it("suma las horas, conserva la descripción y comenta el resumen", async () => {
    const { client, state, task, profile, plan } = await setup();
    const preview = await previewDayChanges(profile, { ...plan(120), missingQuestions: [] }, client, {});
    const up = preview.changes.find((c) => c.op === "update");
    expect(up && up.op === "update" && up.fields["Microsoft.VSTS.Scheduling.CompletedWork"]).toBe(12);
    expect(up && up.op === "update" && up.fields["System.Description"]).toBeUndefined();
    expect(preview.humanSummary.join(" ")).toMatch(/10 → 12/);
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-up-"));
    await applyPreview(client, preview, { approved: true, approvedBy: "t", approvedSnapshotHash: preview.snapshotHash }, { dataDir, profile });
    const after = state.items.get(task.id)!;
    expect(after.fields["System.Description"]).toBe("<p>Criterios de aceptación originales</p>");
    expect(after.fields["Microsoft.VSTS.Scheduling.CompletedWork"]).toBe(12);
  });

  it("un segundo update distinto del mismo día no se salta", async () => {
    const { client, profile, plan } = await setup();
    const a = await previewDayChanges(profile, { ...plan(120), missingQuestions: [] }, client, {});
    const b = await previewDayChanges(profile, { ...plan(180), missingQuestions: [] }, client, {});
    expect(a.changes[0].clientKey).not.toBe(b.changes[0].clientKey);
  });

  it("reconcilia un update incierto leyendo el item", async () => {
    const { client, state, task } = await setup();
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-rec-"));
    const fields = { "Microsoft.VSTS.Scheduling.CompletedWork": 12 };
    await beginPending({ key: "k1", action: "update", previewSnapshotHash: "h", target: { workItemId: task.id, fields }, dataDir });
    await markUnknown("k1", "timeout", dataDir);
    expect((await reconcileClientKey(client, "k1", dataDir)).status).toBe("not_applied_safe_to_retry");
    state.items.get(task.id)!.fields["Microsoft.VSTS.Scheduling.CompletedWork"] = 12;
    await beginPending({ key: "k2", action: "update", previewSnapshotHash: "h", target: { workItemId: task.id, fields }, dataDir });
    await markUnknown("k2", "timeout", dataDir);
    expect((await reconcileClientKey(client, "k2", dataDir)).status).toBe("reconciled");
  });

  it("solo campos (comentario vacío) no deja comentario y el preview no dice que lo haya", async () => {
    const { client, task, profile } = await setup();
    const plan = buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          kind: "planned",
          title: "Etiqueta",
          shortDescription: "Se agrega la etiqueta del proyecto a la tarea ya entregada.",
          workItemType: "Task",
          workItemId: task.id,
          fields: { "System.Tags": "A; B", "System.History": "" },
        },
      ],
    });
    const preview = await previewDayChanges(profile, { ...plan, missingQuestions: [] }, client, {});
    const up = preview.changes.find((c) => c.op === "update");
    expect(up && up.op === "update" && "System.History" in up.fields).toBe(false);
    expect(preview.humanSummary.join(" ")).toMatch(/System.Tags \(sin comentario\)/);
  });

  it("5xx, cortes y JSON inválido son inciertos", () => {
    for (const m of ["createWorkItem HTTP 504: Gateway Time-out", "TypeError: terminated", "Unexpected end of JSON input"]) {
      expect(isUncertainError(new Error(m))).toBe(true);
    }
    expect(isUncertainError(new Error("createWorkItem HTTP 400: campo inválido"))).toBe(false);
  });
});
