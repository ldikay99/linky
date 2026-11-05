import { defineTool } from "eve/tools";
import { z } from "zod";
import { loadProfile } from "#lib/profile/store";
import { buildDayPlan } from "#lib/planning/day";
import { previewDayChanges } from "#lib/apply/preview";
import { createMockAzureClient, createHttpAzureClient } from "#lib/azure/client";
import { readAzurePat } from "#lib/security/secrets";

export default defineTool({
  description: "Previsualiza cambios Azure (incl. adjuntos locales). No aplica. Mock si LINKY_AZURE_MODE=mock.",
  inputSchema: z.object({
    dataDir: z.string().optional(),
    date: z.string().optional(),
    allowHuCreate: z.boolean().optional(),
    intents: z.record(z.string(), z.enum(["entregado", "cerrado", "en_curso", "planeado"])).optional(),
    activities: z.array(
      z.object({
        id: z.string().optional(),
        kind: z.enum(["planned", "done"]),
        title: z.string(),
        shortDescription: z.string().optional(),
        workItemId: z.number().optional(),
        parentHuId: z.number().optional(),
        workItemType: z.string().optional(),
        minutesSpent: z.number().optional(),
        evidenceLinks: z.array(z.string()).optional(),
        evidenceImages: z.array(z.string()).optional(),
        meetingOrCallLinks: z.array(z.string()).optional(),
        expectedRev: z.number().optional(),
      }),
    ),
  }),
  async execute(input) {
    const profile = await loadProfile(input.dataDir);
    if (!profile) return { error: "Sin perfil" };
    const plan = buildDayPlan(profile, { date: input.date, activities: input.activities });
    const useMock = process.env.LINKY_AZURE_MODE === "mock";
    const pat = await readAzurePat();
    if (!useMock && !pat) return { error: "Sin PAT (keyring/env/session)." };
    const client = useMock
      ? createMockAzureClient().client
      : createHttpAzureClient({
          organizationUrl: profile.azure.organizationUrl,
          project: profile.azure.project,
          pat: pat!,
        });
    return previewDayChanges(profile, plan, client, {
      allowHuCreate: input.allowHuCreate,
      intents: input.intents,
    });
  },
});
