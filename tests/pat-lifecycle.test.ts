import { describe, expect, it } from "vitest";
import {
  civilDateInTimeZone,
  daysBetweenYmd,
  evaluatePatReminder,
  validatePatLifecycleInput,
  FULL_ACCESS_WARNING,
  type Clock,
} from "../agent/lib/security/patLifecycle.js";

function clockAt(isoUtc: string): Clock {
  return { nowMs: () => Date.parse(isoUtc) };
}

describe("pat lifecycle", () => {
  it("valida expiry futuro en tz del dispositivo (Bogota)", () => {
    // 2026-11-05 16:00-05 = 2026-11-05 21:00Z
    const r = validatePatLifecycleInput({
      expiresOn: "2026-11-06",
      createdOn: "2026-10-01",
      deviceTimeZone: "America/Bogota",
      scopeChoice: "work_items_rw",
      clock: clockAt("2026-11-05T21:00:00.000Z"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.dateSource).toBe("user_reported");
      expect(r.value.localOsReminderOptIn).toBe(false);
    }
  });

  it("rechaza expiry no futuro según tz (DST-safe civil date)", () => {
    // En Tokyo ya es 2026-11-06 cuando UTC es 2026-11-05 16:00
    const todayTokyo = civilDateInTimeZone(Date.parse("2026-11-05T16:00:00.000Z"), "Asia/Tokyo");
    expect(todayTokyo).toBe("2026-11-06");
    const r = validatePatLifecycleInput({
      expiresOn: "2026-11-06",
      deviceTimeZone: "Asia/Tokyo",
      scopeChoice: "work_items_rw",
      clock: clockAt("2026-11-05T16:00:00.000Z"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/futura|expiresOn/);
  });

  it("rechaza createdOn >= expiresOn y fechas inválidas", () => {
    const a = validatePatLifecycleInput({
      createdOn: "2026-12-01",
      expiresOn: "2026-11-30",
      deviceTimeZone: "UTC",
      scopeChoice: "work_items_rw",
      clock: clockAt("2026-01-01T00:00:00.000Z"),
    });
    expect(a.ok).toBe(false);
    const b = validatePatLifecycleInput({
      expiresOn: "2026-02-30",
      deviceTimeZone: "UTC",
      scopeChoice: "work_items_rw",
      clock: clockAt("2026-01-01T00:00:00.000Z"),
    });
    expect(b.ok).toBe(false);
  });

  it("full access exige acknowledgment", () => {
    const r = validatePatLifecycleInput({
      expiresOn: "2027-01-01",
      deviceTimeZone: "UTC",
      scopeChoice: "full_access",
      clock: clockAt("2026-11-05T00:00:00.000Z"),
    });
    expect(r.ok).toBe(false);
    const ok = validatePatLifecycleInput({
      expiresOn: "2027-01-01",
      deviceTimeZone: "UTC",
      scopeChoice: "full_access",
      fullAccessAcknowledged: true,
      clock: clockAt("2026-11-05T00:00:00.000Z"),
    });
    expect(ok.ok).toBe(true);
    expect(FULL_ACCESS_WARNING).toMatch(/acceso amplio/);
    expect(FULL_ACCESS_WARNING).toMatch(/llavero/);
  });

  it("reminder expired / <=7 / ok con fake clock; sin token en mensajes", () => {
    const life = {
      dateSource: "user_reported" as const,
      expiresOn: "2026-11-10",
      deviceTimeZone: "America/Bogota",
      reminderDaysBefore: 7 as const,
    };
    const token = "synthetic-pat-must-not-appear";
    const expired = evaluatePatReminder(life, clockAt("2026-11-12T15:00:00.000Z"));
    expect(expired.level).toBe("expired");
    expect(JSON.stringify(expired)).not.toContain(token);

    const warn = evaluatePatReminder(life, clockAt("2026-11-05T15:00:00.000Z"));
    expect(warn.level).toBe("warn_7_days");
    expect(warn.daysRemaining).toBe(daysBetweenYmd("2026-11-05", "2026-11-10"));
    expect(warn.message).not.toContain(token);

    const ok = evaluatePatReminder(
      { ...life, expiresOn: "2026-12-31" },
      clockAt("2026-11-05T15:00:00.000Z"),
    );
    expect(ok.level).toBe("ok");
  });

  it("misma civil date en tz distintas al servidor UTC", () => {
    // Server-ish UTC noon vs Bogota morning same calendar day
    const ms = Date.parse("2026-03-08T12:00:00.000Z"); // around DST US; Bogota no DST
    expect(civilDateInTimeZone(ms, "UTC")).toBe("2026-03-08");
    expect(civilDateInTimeZone(ms, "America/Bogota")).toBe("2026-03-08");
    expect(civilDateInTimeZone(ms, "Pacific/Auckland")).toBe("2026-03-09");
  });
});
