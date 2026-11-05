import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { applyPreview } from "#lib/apply/apply";
import { createMockAzureClient, createHttpAzureClient } from "#lib/azure/client";
import { loadProfile } from "#lib/profile/store";
import { readAzurePat } from "#lib/security/secrets";
import type { ApplyPreview } from "#lib/types";

export default defineTool({
  description: "Aplica preview Azure SOLO tras aprobación humana + snapshotHash. Journal fail-closed. No CI real.",
  inputSchema: z.object({
    dataDir: z.string().optional(),
    approvedBy: z.string().min(1),
    approvedSnapshotHash: z.string().min(16),
    note: z.string().optional(),
    preview: z.object({
      generatedAt: z.string(),
      changes: z.array(z.record(z.string(), z.unknown())),
      humanSummary: z.array(z.string()),
      requiresExplicitApproval: z.literal(true),
      snapshotHash: z.string(),
    }),
  }),
  approval: always(),
  async execute(input) {
    const profile = await loadProfile(input.dataDir);
    if (!profile) return { error: "Sin perfil" };
    const useMock = process.env.LINKY_AZURE_MODE === "mock";
    const pat = await readAzurePat();
    const client = useMock
      ? createMockAzureClient().client
      : createHttpAzureClient({
          organizationUrl: profile.azure.organizationUrl,
          project: profile.azure.project,
          pat: pat || "",
        });
    return applyPreview(
      client,
      input.preview as unknown as ApplyPreview,
      {
        approved: true,
        approvedBy: input.approvedBy,
        approvedSnapshotHash: input.approvedSnapshotHash,
        note: input.note,
      },
      { dataDir: input.dataDir, profile },
    );
  },
});
