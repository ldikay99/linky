import { defineTool } from "eve/tools";
import { z } from "zod";
import { loadProfile } from "#lib/profile/store";
import { buildDayPlan } from "#lib/planning/day";
import { writeDayMessageDrafts } from "#lib/messaging/drafts";

export default defineTool({
  description: "Genera borradores de mensajes de inicio/cierre de jornada. No envía a terceros ni activa schedules.",
  inputSchema: z.object({
    dataDir: z.string().optional(),
    date: z.string().optional(),
    activities: z.array(
      z.object({
        kind: z.enum(["planned", "done"]),
        title: z.string(),
        shortDescription: z.string().optional(),
        minutesSpent: z.number().optional(),
        evidenceLinks: z.array(z.string()).optional(),
        evidenceImages: z.array(z.string()).optional(),
        meetingOrCallLinks: z.array(z.string()).optional(),
        workItemId: z.number().optional(),
        parentHuId: z.number().optional(),
        workItemType: z.string().optional(),
      }),
    ),
  }),
  async execute(input) {
    const profile = await loadProfile(input.dataDir);
    if (!profile) return { error: "Sin perfil" };
    const plan = buildDayPlan(profile, { date: input.date, activities: input.activities });
    const drafts = await writeDayMessageDrafts(profile, plan, input.dataDir);
    return { drafts, schedulingEnabled: profile.messaging.schedulingEnabled };
  },
});
