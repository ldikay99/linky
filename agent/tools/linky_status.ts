import { defineTool } from "eve/tools";
import { z } from "zod";
import { loadProfile, profileExistsSummary } from "#lib/profile/store";
import { readAzurePat, patStatusLabel } from "#lib/security/secrets";
import { linkyDataDir } from "#lib/security/paths";

export default defineTool({
  description: "Muestra si Linky está configurado (sin revelar secretos ni fragmentos de PAT).",
  inputSchema: z.object({ dataDir: z.string().optional() }),
  async execute({ dataDir }) {
    const profile = await loadProfile(dataDir);
    if (!profile) return { configured: false, dataDir: linkyDataDir(dataDir) };
    const pat = await readAzurePat();
    return {
      configured: true,
      dataDir: linkyDataDir(dataDir),
      summary: profileExistsSummary(profile),
      pat: patStatusLabel(Boolean(pat)),
      secretBackend: profile.secretBackend ?? null,
      schedulingEnabled: profile.messaging.schedulingEnabled,
      aiNote:
        process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
          ? "IA/Gateway parece configurada por entorno"
          : "Núcleo determinista usable sin IA pagada; Gateway no detectada",
    };
  },
});
