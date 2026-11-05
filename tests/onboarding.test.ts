import { describe, expect, it } from "vitest";
import { mkdtemp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockAzureClient } from "../agent/lib/azure/client.js";
import { runOnboarding } from "../agent/lib/onboarding/wizard.js";
import { loadProfile } from "../agent/lib/profile/store.js";
import { createFakeSecretStore } from "../agent/lib/security/secretStore.js";
import { secretsDir } from "../agent/lib/security/paths.js";
import type { OnboardingAnswers } from "../agent/lib/onboarding/wizard.js";

const baseAnswers: OnboardingAnswers = {
  organizationUrl: "https://dev.azure.com/ExampleOrg",
  project: "Example Project",
  pat: "synthetic-pat-not-real-0000",
  occupation: "Ingeniero de datos",
  projectContext: "Plataforma sintética de reportes y calidad de datos",
  assignedDisplayName: "Persona Demo",
  responsibleTag: "RESPONSABLE-DEMO",
  responsibleMention: "@responsable.demo",
  huCreation: "scrum_or_third_party_only",
  huRefine: "scrum_or_third_party_only",
  taskDelivery: "same_user",
  taskClose: "scrum_or_third_party",
  huClose: "scrum_or_third_party",
  lunchMinutes: 60,
  lunchStart: "12:00",
  lunchEnd: "13:00",
  confirmScheduleInterpretation: true,
  ambiguousScheduleText: "lunes a viernes 8:30–18 y viernes 8–17",
  patCreatedOn: "2026-10-01",
  patExpiresOn: "2027-06-01",
  deviceTimeZone: "America/Bogota",
  confirmDeviceTimeZone: true,
  scopeChoice: "work_items_rw",
};

describe("onboarding", () => {
  it("exige proyecto/ocupación/contexto/almuerzo/horario confirmado; sin PAT en perfil", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-test-"));
    const fake = createFakeSecretStore();
    const { client } = createMockAzureClient();
    const result = await runOnboarding(baseAnswers, {
      dataDir,
      createClient: () => client,
      secretStore: fake,
      nowMs: Date.parse("2026-11-05T15:00:00.000Z"),
    });
    const profile = await loadProfile(dataDir);
    expect(profile!.azure.project).toBe("Example Project");
    expect(profile!.workContext.occupation).toMatch(/Ingeniero/);
    expect(profile!.closeRequiresExplicitUserIntent).toBe(true);
    expect(profile!.schedule.scheduleInterpretationConfirmed).toBe(true);
    expect(profile!.schedule.lunchAsked).toBe(true);
    expect(profile!.responsibility.responsibleTag).toBe("RESPONSABLE-DEMO");
    expect(JSON.stringify(profile)).not.toContain("synthetic-pat-not-real-0000");
    expect(result.scheduleSummary).toMatch(/lun/);
    await expect(access(path.join(secretsDir(dataDir), "azure-pat"))).rejects.toBeTruthy();
  });

  it("falla sin confirmScheduleInterpretation", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-test-"));
    const fake = createFakeSecretStore();
    const { client } = createMockAzureClient();
    await expect(
      runOnboarding(
        { ...baseAnswers, confirmScheduleInterpretation: false as unknown as true },
        { dataDir, createClient: () => client, secretStore: fake, nowMs: Date.parse("2026-11-05T15:00:00.000Z") },
      ),
    ).rejects.toThrow(/confirmScheduleInterpretation/);
  });

  it("rechaza organizationUrl arbitraria", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-test-"));
    const fake = createFakeSecretStore();
    const { client } = createMockAzureClient();
    await expect(
      runOnboarding(
        { ...baseAnswers, organizationUrl: "https://evil.example/steal" },
        { dataDir, createClient: () => client, secretStore: fake, nowMs: Date.parse("2026-11-05T15:00:00.000Z") },
      ),
    ).rejects.toThrow(/no permitida|HTTPS|dev\.azure/i);
  });
});
