import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockAzureClient } from "../agent/lib/azure/client.js";
import { applyPreview, reconcileClientKey } from "../agent/lib/apply/apply.js";
import { hashPreviewSnapshot } from "../agent/lib/apply/idempotency.js";
import { createEmptyProfile } from "../agent/lib/profile/store.js";
import { linkyClientKeyMarker } from "../agent/lib/azure/attachments.js";
import type { ApplyPreview } from "../agent/lib/types.js";

function withHash(preview: Omit<ApplyPreview, "snapshotHash">): ApplyPreview {
  const p = { ...preview, snapshotHash: "" };
  p.snapshotHash = hashPreviewSnapshot(p);
  return p;
}

describe("apply journal fail-closed", () => {
  const profile = createEmptyProfile({
    azure: { organizationUrl: "https://dev.azure.com/ExampleOrg", project: "Example", defaultTags: [] },
    workContext: { occupation: "Ingeniero de datos", projectContext: "Demo pipelines sintéticos" },
    responsibility: { assignedDisplayName: "Persona Demo", responsibleTag: "DEMO-TAG" },

  });

  it("no duplica creates en reintento completed", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-apply-"));
    const { client, state } = createMockAzureClient();
    const key = "create::2026-11-05::act-1::Demo";
    const preview = withHash({
      generatedAt: new Date().toISOString(),
      requiresExplicitApproval: true,
      humanSummary: ["test"],
      changes: [
        {
          op: "create",
          clientKey: key,
          workItemType: "Task",
          parentHuId: 1,
          relations: [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/ExampleOrg/Example%20Project/_apis/wit/workItems/1" }],
          fields: {
            "System.Title": "Demo",
            "System.Description": `<div>desc${linkyClientKeyMarker(key)}</div>`,
          },
        },
      ],
    });
    const r1 = await applyPreview(
      client,
      preview,
      { approved: true, approvedBy: "tester", approvedSnapshotHash: preview.snapshotHash },
      { dataDir, profile },
    );
    const r2 = await applyPreview(
      client,
      preview,
      { approved: true, approvedBy: "tester", approvedSnapshotHash: preview.snapshotHash },
      { dataDir, profile },
    );
    expect(r1.applied).toHaveLength(1);
    expect(r2.skippedIdempotent).toContain(key);
    expect(state.createCallCount).toBe(1);
  });

  it("si Azure crea pero la respuesta falla, NO hay segundo POST", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-uncertain-"));
    const { client, state } = createMockAzureClient({ failAfterCreate: true });
    const key = "create::2026-11-05::act-x::Lost";
    const preview = withHash({
      generatedAt: new Date().toISOString(),
      requiresExplicitApproval: true,
      humanSummary: [],
      changes: [
        {
          op: "create",
          clientKey: key,
          workItemType: "Task",
          parentHuId: 1,
          relations: [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/ExampleOrg/Example%20Project/_apis/wit/workItems/1" }],
          fields: {
            "System.Title": "Lost",
            "System.Description": `<div>${linkyClientKeyMarker(key)}</div>`,
          },
        },
      ],
    });
    const r1 = await applyPreview(
      client,
      preview,
      { approved: true, approvedBy: "tester", approvedSnapshotHash: preview.snapshotHash },
      { dataDir, profile },
    );
    expect(r1.needsReconcile).toContain(key);
    expect(state.createCallCount).toBe(1);
    expect(state.items.size).toBe(1);

    const r2 = await applyPreview(
      client,
      preview,
      { approved: true, approvedBy: "tester", approvedSnapshotHash: preview.snapshotHash },
      { dataDir, profile },
    );
    expect(r2.blocked.some((b) => b.clientKey === key)).toBe(true);
    expect(state.createCallCount).toBe(1);

    const rec = await reconcileClientKey(client, key, dataDir);
    expect(rec.status).toBe("reconciled");
    expect(rec.workItemId).toBeTruthy();
  });

  it("rechaza apply si snapshot no coincide", async () => {
    const { client } = createMockAzureClient();
    const preview = withHash({
      generatedAt: new Date().toISOString(),
      requiresExplicitApproval: true,
      humanSummary: [],
      changes: [],
    });
    await expect(
      applyPreview(
        client,
        preview,
        { approved: true, approvedBy: "x", approvedSnapshotHash: "deadbeef" },
        { dataDir: undefined, profile },
      ),
    ).rejects.toThrow(/approvedSnapshotHash/);
  });

  it("rechaza approvedBy vacío", async () => {
    const { client } = createMockAzureClient();
    const preview = withHash({
      generatedAt: new Date().toISOString(),
      requiresExplicitApproval: true,
      humanSummary: [],
      changes: [],
    });
    await expect(
      applyPreview(
        client,
        preview,
        { approved: true, approvedBy: "", approvedSnapshotHash: preview.snapshotHash },
        { profile },
      ),
    ).rejects.toThrow(/approvedBy/);
  });
});
