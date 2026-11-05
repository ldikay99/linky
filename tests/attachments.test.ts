import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockAzureClient } from "../agent/lib/azure/client.js";
import { applyPreview } from "../agent/lib/apply/apply.js";
import { hashPreviewSnapshot } from "../agent/lib/apply/idempotency.js";
import { createEmptyProfile } from "../agent/lib/profile/store.js";
import { attachmentRelationPatch } from "../agent/lib/azure/attachments.js";
import type { ApplyPreview } from "../agent/lib/types.js";

// Minimal valid PNG 1x1
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("attachments API mock", () => {
  it("create y update enlazan AttachedFile con bytes reales", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-att-"));
    const imgPath = path.join(dataDir, "shot.png");
    await writeFile(imgPath, PNG);
    const { client, state } = createMockAzureClient();
    const profile = createEmptyProfile({
      azure: { organizationUrl: "https://dev.azure.com/ExampleOrg", project: "Example Project", defaultTags: [] },
    workContext: { occupation: "Ingeniero de datos", projectContext: "Demo pipelines sintéticos" },
    responsibility: { assignedDisplayName: "Persona Demo", responsibleTag: "DEMO-TAG" },

    });

    // seed item for update
    const seeded = await client.createWorkItem("Task", [
      { op: "add", path: "/fields/System.Title", value: "Seed" },
    ]);

    const createKey = "create::2026-11-05::a::WithImg";
    const updateKey = `update::2026-11-05::b::${seeded.id}`;

    const preview: ApplyPreview = {
      generatedAt: new Date().toISOString(),
      requiresExplicitApproval: true,
      humanSummary: [],
      changes: [
        {
          op: "create",
          clientKey: createKey,
          workItemType: "Task",
          parentHuId: seeded.id,
          relations: [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/ExampleOrg/Example%20Project/_apis/wit/workItems/1" }],
          fields: { "System.Title": "WithImg", "System.Description": "<!--linky:clientKey=create::2026-11-05::a::WithImg-->" },
          attachments: [
            { localPath: imgPath, fileName: "shot.png", contentType: "image/png", byteLength: PNG.length },
          ],
        },
        {
          op: "update",
          workItemId: seeded.id,
          clientKey: updateKey,
          fields: { "System.History": "con foto" },
          attachments: [
            { localPath: imgPath, fileName: "shot.png", contentType: "image/png", byteLength: PNG.length },
          ],
        },
      ],
      snapshotHash: "",
    };
    preview.snapshotHash = hashPreviewSnapshot(preview);

    const result = await applyPreview(
      client,
      preview,
      { approved: true, approvedBy: "tester", approvedSnapshotHash: preview.snapshotHash },
      { dataDir, profile },
    );
    expect(result.errors).toEqual([]);
    expect(result.applied).toHaveLength(2);
    expect(state.lastUpload?.byteLength).toBe(PNG.length);
    expect(state.lastUpload?.contentType).toBe("image/png");
    expect([...state.attachments.values()][0]?.bytes.byteLength).toBe(PNG.length);

    const created = [...state.items.values()].find((i) => i.fields["System.Title"] === "WithImg");
    expect(created?.relations?.some((r) => r.rel === "AttachedFile")).toBe(true);
    const updated = state.items.get(seeded.id)!;
    expect(updated.relations?.some((r) => r.rel === "AttachedFile")).toBe(true);

    const rel = attachmentRelationPatch("mock://attachments/x");
    expect(rel.value.rel).toBe("AttachedFile");
  });
});
