import { describe, expect, it } from "vitest";
import { createEmptyProfile } from "../agent/lib/profile/store.js";
import { validateDayCoverage } from "../agent/lib/planning/coverage.js";
import { interpretAmbiguousWorkweekText } from "../agent/lib/planning/scheduleParse.js";
import { applyPlanningMargin } from "../agent/lib/planning/estimates.js";

describe("coverage and schedule interpretation", () => {
  it("interpreta texto ambiguo lun-vie + viernes", () => {
    const r = interpretAmbiguousWorkweekText("lunes a viernes 8:30–18 y viernes 8–17");
    expect(r.interpretation.mondayToThursday).toEqual({ start: "08:30", end: "18:00" });
    expect(r.interpretation.friday).toEqual({ start: "08:00", end: "17:00" });
    expect(r.needsConfirmation).toBe(true);
  });

  it("reporta huecos sin inventar actividades", () => {
    const profile = createEmptyProfile({
      azure: { organizationUrl: "https://dev.azure.com/ExampleOrg", project: "Example Project", defaultTags: [] },
      workContext: { occupation: "Dev", projectContext: "Demo" },
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
    // Thursday 2026-11-05
    const cov = validateDayCoverage(profile.schedule, "2026-11-05", [
      {
        id: "a1",
        kind: "done",
        title: "Solo mañana",
        shortDescription: "Trabajé en la mañana.",
        workItemType: "Task",
        minutesSpent: 120,
        evidenceLinks: [],
        evidenceImages: [],
        meetingOrCallLinks: [],
        timeRange: { start: "08:30", end: "10:30" },
      },
    ]);
    expect(cov.gaps.length).toBeGreaterThan(0);
    expect(cov.questions.join(" ")).toMatch(/Hueco/);

    // Día parcial pedido por la persona: los huecos se reportan pero no bloquean.
    const parcial = validateDayCoverage(
      profile.schedule,
      "2026-11-05",
      [
        {
          id: "a1",
          kind: "done",
          title: "Solo mañana",
          shortDescription: "Trabajé en la mañana.",
          workItemType: "Task",
          minutesSpent: 120,
          evidenceLinks: [],
          evidenceImages: [],
          meetingOrCallLinks: [],
          timeRange: { start: "08:30", end: "10:30" },
        },
      ],
      { allowGaps: true },
    );
    expect(parcial.gaps.length).toBeGreaterThan(0);
    expect(parcial.questions).toEqual([]);
    expect(parcial.ok).toBe(true);
  });

  it("margen solo con aprobación y no toca reales", () => {
    const r = applyPlanningMargin(100, { planningMarginPercent: 10, requireMarginApproval: true }, false);
    expect(r.estimateMinutes).toBe(100);
    const r2 = applyPlanningMargin(100, { planningMarginPercent: 10, requireMarginApproval: true }, true);
    expect(r2.estimateMinutes).toBe(110);
  });
});
