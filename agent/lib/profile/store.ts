import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { LinkyProfile } from "../types.js";
import { linkyDataDir, profilePath } from "../security/paths.js";
import { assertNoSecretInObject } from "../security/secrets.js";
import { defaultProposedSchedule } from "../planning/scheduleParse.js";

export function defaultSchedule(): LinkyProfile["schedule"] {
  const base = defaultProposedSchedule("America/Bogota");
  return {
    ...base,
    lunchAsked: true,
    lunchMinutes: 60,
    scheduleInterpretationConfirmed: false,
  };
}

export function defaultEvidence(): LinkyProfile["evidence"] {
  return {
    allowLinks: true,
    allowImages: true,
    maxImageBytes: 5 * 1024 * 1024,
    allowedImageMime: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    requireAccessNote: true,
  };
}

export function defaultDescription(): LinkyProfile["description"] {
  return {
    planningTense: "future",
    executionTense: "past",
    maxChars: 500,
    requireShortDirect: true,
  };
}

export function defaultEstimate(): LinkyProfile["estimate"] {
  return { planningMarginPercent: 10, requireMarginApproval: true };
}

export async function loadProfile(dataDir?: string): Promise<LinkyProfile | null> {
  try {
    const raw = await readFile(profilePath(dataDir), "utf8");
    return JSON.parse(raw) as LinkyProfile;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: LinkyProfile, dataDir?: string): Promise<string> {
  assertNoSecretInObject(profile);
  const dir = linkyDataDir(dataDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const p = profilePath(dataDir);
  const next = { ...profile, updatedAt: new Date().toISOString() };
  await writeFile(p, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return p;
}

export function createEmptyProfile(
  partial: Partial<LinkyProfile> & {
    azure: LinkyProfile["azure"];
    workContext: LinkyProfile["workContext"];
    responsibility?: LinkyProfile["responsibility"];
  },
): LinkyProfile {
  const now = new Date().toISOString();
  if (!partial.azure.project?.trim()) {
    throw new Error("azure.project es obligatorio (setup); no se infiere default.");
  }
  if (!partial.workContext?.occupation?.trim() || !partial.workContext?.projectContext?.trim()) {
    throw new Error("workContext.occupation y projectContext son obligatorios en setup.");
  }
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    azure: partial.azure,
    responsibility: partial.responsibility ?? {},
    workContext: partial.workContext,
    huCreation: partial.huCreation ?? "scrum_or_third_party_only",
    huRefine: partial.huRefine ?? partial.huCreation ?? "scrum_or_third_party_only",
    taskDelivery: partial.taskDelivery ?? "same_user",
    taskClose: partial.taskClose ?? "scrum_or_third_party",
    huClose: partial.huClose ?? "scrum_or_third_party",
    closeRequiresExplicitUserIntent: true,
    schedule: partial.schedule ?? defaultSchedule(),
    estimate: partial.estimate ?? defaultEstimate(),
    evidence: partial.evidence ?? defaultEvidence(),
    description: partial.description ?? defaultDescription(),
    lastPermissionProbe: partial.lastPermissionProbe,
    processCache: partial.processCache,
    secretBackend: partial.secretBackend,
    patLifecycle: partial.patLifecycle,
    messaging: partial.messaging ?? {
      mode: "draft_only",
      sendStartOfDay: true,
      sendEndOfDay: true,
      schedulingEnabled: false,
    },
  };
}

export function profileExistsSummary(profile: LinkyProfile): string[] {
  return [
    `Org: ${profile.azure.organizationUrl}`,
    `Proyecto: ${profile.azure.project}`,
    `Ocupación: ${profile.workContext.occupation}`,
    `Contexto proyecto: ${profile.workContext.projectContext.slice(0, 80)}…`,
    `Asignado: ${profile.responsibility.assignedDisplayName ?? profile.azure.identityDisplayName ?? "(n/d)"}`,
    `Responsable tag/mención: ${profile.responsibility.responsibleTag ?? ""} / ${profile.responsibility.responsibleMention ?? ""}`,
    `HU crea/refina: ${profile.huCreation} / ${profile.huRefine}`,
    `Cierre solo con intención explícita: ${profile.closeRequiresExplicitUserIntent}`,
    `TZ jornada: ${profile.schedule.timezone} lun-jue ${profile.schedule.mondayToThursday.start}-${profile.schedule.mondayToThursday.end} vie ${profile.schedule.friday.start}-${profile.schedule.friday.end}`,
    `Almuerzo: ${profile.schedule.lunchMinutes} min (asked=${profile.schedule.lunchAsked})`,
  ];
}
