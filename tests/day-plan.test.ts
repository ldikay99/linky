import { describe, expect, it } from "vitest";
import { createEmptyProfile } from "../agent/lib/profile/store.js";
import { buildDayPlan } from "../agent/lib/planning/day.js";

describe("day plan", () => {
  const profile = createEmptyProfile({
    azure: {
      organizationUrl: "https://dev.azure.com/ExampleOrg",
      project: "Example",
      defaultTags: ["DEMO"],
    },
    workContext: { occupation: "Ingeniero de datos", projectContext: "Demo pipelines sintéticos" },
    responsibility: { assignedDisplayName: "Persona Demo", responsibleTag: "DEMO-TAG" },

  });

  it("pide faltantes y no inventa evidencia", () => {
    const plan = buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          kind: "done",
          title: "Algo",
          shortDescription: "Implementé el ajuste del export.",
          workItemType: "Task",
        },
      ],
    });
    expect(plan.missingQuestions.some((q) => /minutos/.test(q))).toBe(true);
    expect(plan.missingQuestions.some((q) => /evidencia/.test(q))).toBe(true);
  });

  it("conserva los campos explícitos de la actividad", () => {
    const plan = buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          kind: "done",
          title: "Algo",
          shortDescription: "Implementé el ajuste del export.",
          workItemType: "Task",
          fields: { "Microsoft.VSTS.Common.Activity": "Development" },
        },
      ],
    });
    expect(plan.activities[0].fields).toEqual({ "Microsoft.VSTS.Common.Activity": "Development" });
  });

  it("bloquea fechas en una descripción HTML explícita", () => {
    const plan = buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          kind: "done",
          title: "Algo",
          shortDescription: "Implementé el ajuste del export.",
          workItemType: "Task",
          fields: { "System.Description": "<div>Se entregó el 5 de noviembre.</div>" },
        },
      ],
    });
    expect(plan.missingQuestions.join(" ")).toMatch(/no lleva fechas/);
  });

  it("bloquea crear HU si política scrum", () => {
    const plan = buildDayPlan(profile, {
      date: "2026-11-05",
      activities: [
        {
          kind: "planned",
          title: "Nueva historia",
          shortDescription: "Definiré el alcance con el equipo.",
          workItemType: "User Story",
        },
      ],
    });
    expect(plan.missingQuestions.join(" ")).toMatch(/scrum/);
  });
});
