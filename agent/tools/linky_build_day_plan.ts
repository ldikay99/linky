import { defineTool } from "eve/tools";
import { z } from "zod";
import { loadProfile } from "#lib/profile/store";
import { buildDayPlan } from "#lib/planning/day";

export default defineTool({
  description: "Construye el plan del día reusando el perfil; lista solo preguntas faltantes. No escribe en Azure.",
  inputSchema: z.object({
    dataDir: z.string().optional(),
    date: z.string().optional(),
    activities: z.array(
      z.object({
        id: z.string().optional(),
        kind: z.enum(["planned", "done"]),
        title: z.string().min(1),
        shortDescription: z.string().optional(),
        workItemId: z.number().optional(),
        parentHuId: z.number().optional(),
        workItemType: z.string().optional(),
        minutesSpent: z.number().optional(),
        evidenceLinks: z.array(z.string()).optional(),
        evidenceImages: z.array(z.string()).optional(),
        meetingOrCallLinks: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }),
    ),
  }),
  async execute(input) {
    const profile = await loadProfile(input.dataDir);
    if (!profile) return { error: "Sin perfil. Ejecuta onboarding CLI primero." };
    const plan = buildDayPlan(profile, {
      date: input.date,
      activities: input.activities,
    });
    return plan;
  },
});
