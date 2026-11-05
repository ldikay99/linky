import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockAzureClient } from "../agent/lib/azure/client.js";
import { applyPreview } from "../agent/lib/apply/apply.js";
import { hashPreviewSnapshot } from "../agent/lib/apply/idempotency.js";
import { createEmptyProfile } from "../agent/lib/profile/store.js";
import type { ApplyPreview } from "../agent/lib/types.js";

describe("policy enforce on apply", () => {
  it("bloquea create HU aunque el preview lo traiga", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-pol-"));
    const { client, state } = createMockAzureClient();
    const profile = createEmptyProfile({
      azure: { organizationUrl: "https://dev.azure.com/ExampleOrg", project: "Example", defaultTags: [] },
    workContext: { occupation: "Ingeniero de datos", projectContext: "Demo pipelines sintéticos" },
    responsibility: { assignedDisplayName: "Persona Demo", responsibleTag: "DEMO-TAG" },

      huCreation: "scrum_or_third_party_only",
    });
    const preview: ApplyPreview = {
      generatedAt: new Date().toISOString(),
      requiresExplicitApproval: true,
      humanSummary: [],
      changes: [
        {
          op: "create",
          clientKey: "create::hack::HU",
          workItemType: "User Story",
          fields: { "System.Title": "Hack HU" },
        },
      ],
      snapshotHash: "",
    };
    preview.snapshotHash = hashPreviewSnapshot(preview);
    const result = await applyPreview(
      client,
      preview,
      { approved: true, approvedBy: "x", approvedSnapshotHash: preview.snapshotHash },
      { dataDir, profile },
    );
    expect(result.blocked[0]?.reason).toMatch(/scrum/);
    expect(state.createCallCount).toBe(0);
  });
});
