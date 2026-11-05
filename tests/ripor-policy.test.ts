import { describe, expect, it } from "vitest";
import { evaluateRiporPolicy, sumExistingHoursStrict } from "../agent/lib/ripor/policy.js";
import { expectedHoursForDate, isWorkday, weekdayLocalFromYmd } from "../agent/lib/ripor/schedule.js";
import { validateEvidenceUrls } from "../agent/lib/ripor/evidence.js";
import { buildRiporDailyDescription } from "../agent/lib/ripor/description.js";
import { emptyRiporProfile, buildRiporProfileFromSetup } from "../agent/lib/ripor/setup.js";
import { DEFAULT_RIPOR_SCHEDULE } from "../agent/lib/ripor/types.js";
import type { RiporCoverageProof, RiporDraftFields, RiporProfile } from "../agent/lib/ripor/types.js";
import { linkyDataDir, detectLinkyRepoRoot, isPathInside } from "../agent/lib/security/paths.js";
import path from "node:path";
import { tmpdir } from "node:os";

function proof(hours = 8.5): RiporCoverageProof {
  return {
    sustainedActivityHours: hours,
    coversDraftDedication: true,
    source: "azure_confirmed",
  };
}

function baseDraft(over: Partial<RiporDraftFields> = {}): RiporDraftFields {
  return {
    dateYmd: "2026-11-05",
    areaProjectLabel: "Área X",
    taskLabel: "Tarea Personalizada",
    hours: 8.5,
    description: "Trabajo confirmado en Azure.",
    evidenceUrls: ["https://github.com/example/repo"],
    transportLabel: "🏠 Trabajo Remoto",
    transportIsDailyOverride: false,
    ...over,
  };
}

function profile(): RiporProfile {
  const p = emptyRiporProfile();
  p.setupComplete = true;
  p.areaProject = { label: "Área X", verifiedFromUi: true };
  p.defaultTransport = { label: "🏠 Trabajo Remoto", verifiedFromUi: true };
  return p;
}

describe("ripor schedule", () => {
  it("detects weekday and expected hours", () => {
    expect(weekdayLocalFromYmd("2026-11-05")).toBe(4);
    expect(expectedHoursForDate("2026-11-05")).toBe(8.5);
    expect(expectedHoursForDate("2026-11-06")).toBe(8);
    expect(expectedHoursForDate("2026-11-07")).toBe(0);
    expect(isWorkday("2026-11-05")).toBe(true);
  });
});

describe("ripor evidence", () => {
  it("rejects credentials in URL", () => {
    expect(validateEvidenceUrls(["https://user:pass@evil.example/x"]).ok).toBe(false);
  });
  it("accepts https links", () => {
    const r = validateEvidenceUrls(["https://github.com/example/a", "https://github.com/example/b"]);
    expect(r.ok).toBe(true);
  });
});

describe("ripor description", () => {
  it("excludes future plans", () => {
    const r = buildRiporDailyDescription([
      { title: "Hecho A", doneSummary: "Completé A", isFuturePlan: false },
      { title: "Plan B", isFuturePlan: true },
    ]);
    expect(r.description).toContain("Completé A");
    expect(r.rejected).toHaveLength(1);
  });
});

describe("ripor policy coverage fail-closed", () => {
  it("blocks when coverageProof and under are both missing", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft(),
      existingSameDay: [],
      profile: profile(),
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /coverageProof|omisión/i.test(b))).toBe(true);
  });

  it("blocks activitiesCoverFullDay=true without sustained proof", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft(),
      existingSameDay: [],
      profile: profile(),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(false);
  });

  it("allows full day with coverageProof sustained >= draft", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft(),
      existingSameDay: [],
      profile: profile(),
      coverageProof: proof(8.5),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks inflate: sustained < draft.hours", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft({ hours: 8.5 }),
      existingSameDay: [],
      profile: profile(),
      coverageProof: proof(4),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /Sustained/i.test(b))).toBe(true);
  });

  it("under válido + fullDay false no bloquea automáticamente", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft({
        hours: 4,
        explicitUnderHoursRequest: { dateYmd: "2026-11-05", hours: 4, reason: "media jornada" },
      }),
      existingSameDay: [],
      profile: profile(),
      activitiesCoverFullDay: false,
      coverageProof: proof(4),
    });
    expect(r.ok).toBe(true);
  });

  it("under without dateYmd link blocked", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft({
        hours: 4,
        // @ts-expect-error adversarial missing date
        explicitUnderHoursRequest: { hours: 4 },
      }),
      existingSameDay: [],
      profile: profile(),
      coverageProof: proof(4),
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /vincularse|dateYmd/i.test(b))).toBe(true);
  });

  it("under date mismatched to mutation blocked", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft({
        hours: 4,
        explicitUnderHoursRequest: { dateYmd: "2026-11-04", hours: 4 },
      }),
      existingSameDay: [],
      profile: profile(),
      coverageProof: proof(4),
    });
    expect(r.ok).toBe(false);
  });

  it("weekend blocked even with under (no bypass)", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-07", // Sat
      draft: baseDraft({
        dateYmd: "2026-11-07",
        hours: 4,
        explicitUnderHoursRequest: { dateYmd: "2026-11-07", hours: 4 },
      }),
      existingSameDay: [],
      profile: profile(),
      coverageProof: proof(4),
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /Fin de semana|weekend|no laboral/i.test(b))).toBe(true);
  });

  it("compares sustained to draft not double-counting existing others", () => {
    // existing 4h already; adding 4.5 to complete 8.5 — sustained only needs to cover THIS draft 4.5
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft({ hours: 4.5 }),
      existingSameDay: [{ id: "e1", dateYmd: "2026-11-05", hours: 4 }],
      profile: profile(),
      coverageProof: proof(4.5),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(true);
    expect(r.proposedTotalHours).toBe(8.5);
  });

  it("never exceeds max including existing", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft({ hours: 8.5 }),
      existingSameDay: [{ id: "1", dateYmd: "2026-11-05", hours: 2 }],
      profile: profile(),
      coverageProof: proof(8.5),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /Excede/i.test(b))).toBe(true);
  });

  it("NaN existing hours blocks (not treated as 0)", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft(),
      existingSameDay: [{ id: "bad", dateYmd: "2026-11-05", hours: Number.NaN }],
      profile: profile(),
      coverageProof: proof(8.5),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /NaN|finito/i.test(b))).toBe(true);
  });

  it("wrong-date existing blocks", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft(),
      existingSameDay: [{ id: "x", dateYmd: "2026-11-04", hours: 1 }],
      profile: profile(),
      coverageProof: proof(8.5),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(false);
  });

  it("update target missing blocks", () => {
    const r = evaluateRiporPolicy({
      op: "update",
      dateYmd: "2026-11-05",
      draft: baseDraft(),
      existingSameDay: [{ id: "other", dateYmd: "2026-11-05", hours: 8.5 }],
      profile: profile(),
      reportId: "missing",
      coverageProof: proof(8.5),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /no existe/i.test(b))).toBe(true);
  });

  it("delete target missing blocks", () => {
    const r = evaluateRiporPolicy({
      op: "delete",
      dateYmd: "2026-11-05",
      existingSameDay: [{ id: "9", dateYmd: "2026-11-05", hours: 8.5 }],
      profile: profile(),
      reportId: "nope",
    });
    expect(r.ok).toBe(false);
  });

  it("friday expects 8h with proof", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-06",
      draft: baseDraft({ dateYmd: "2026-11-06", hours: 8 }),
      existingSameDay: [],
      profile: profile(),
      coverageProof: proof(8),
      activitiesCoverFullDay: true,
    });
    expect(r.ok).toBe(true);
    expect(r.expectedHoursForDay).toBe(DEFAULT_RIPOR_SCHEDULE.expectedHoursFriday);
  });

  it("skip day always blocks", () => {
    const r = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-05",
      draft: baseDraft({ skipDay: true, skipReason: "festivo" }),
      existingSameDay: [],
      profile: profile(),
      coverageProof: proof(8.5),
    });
    expect(r.ok).toBe(false);
  });
});

describe("sumExistingHoursStrict", () => {
  it("rejects negative", () => {
    const r = sumExistingHoursStrict([{ id: "a", dateYmd: "2026-11-05", hours: -1 }], {
      dateYmd: "2026-11-05",
    });
    expect(r.ok).toBe(false);
  });
});

describe("ripor setup", () => {
  it("rejects area project not in UI options", () => {
    const r = buildRiporProfileFromSetup({
      uiObserved: false,
      uiAreaProjects: [{ label: "A", verifiedFromUi: false }],
      chosenAreaProjectLabel: "NOPE",
      uiTransportOptions: [{ label: "remoto", verifiedFromUi: false }],
      chosenTransportLabel: "remoto",
    });
    expect(r.ok).toBe(false);
  });

  it("builds profile distinguishing azure hints; default task Personalizada", () => {
    const r = buildRiporProfileFromSetup({
      uiObserved: true,
      uiAreaProjects: [{ label: "Área Demo", verifiedFromUi: true }],
      chosenAreaProjectLabel: "Área Demo",
      uiTransportOptions: [{ label: "🏠 Trabajo Remoto", verifiedFromUi: true }],
      chosenTransportLabel: "🏠 Trabajo Remoto",
      azureProjectHints: ["AzureProj1", "AzureProj2"],
    });
    expect(r.ok).toBe(true);
    expect(r.profile!.defaultTaskLabel).toBe("Tarea Personalizada");
    expect(r.profile!.azureProjectHints).toHaveLength(2);
  });
});

describe("data-dir canonical outside repo", () => {
  it("rejects data-dir inside linky repo", () => {
    const repo = detectLinkyRepoRoot(process.cwd());
    expect(repo).toBeTruthy();
    expect(() => linkyDataDir(path.join(repo!, ".linky-demo"))).toThrow(/rechazado|dentro del repo/i);
  });

  it("allows tmp outside repo", () => {
    const dir = path.join(tmpdir(), "linky-data-canonical-test");
    const repo = detectLinkyRepoRoot(process.cwd());
    expect(repo && isPathInside(dir, repo)).toBe(false);
    expect(linkyDataDir(dir)).toBe(path.resolve(dir));
  });
});
