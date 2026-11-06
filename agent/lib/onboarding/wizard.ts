import type { AzureClient } from "../azure/client.js";
import { detectProcessMeta, summarizeFieldAvailability } from "../azure/fields.js";
import {
  createEmptyProfile as buildProfile,
  defaultSchedule,
  defaultEvidence,
  defaultDescription,
  defaultEstimate,
  saveProfile as persist,
} from "../profile/store.js";
import { saveAzurePat, patStatusLabel } from "../security/secrets.js";
import type { SecretStore } from "../security/secretStore.js";
import { validateOrganizationUrl } from "../security/orgUrl.js";
import {
  detectDeviceTimeZone,
  FULL_ACCESS_WARNING,
  validatePatLifecycleInput,
  type PatScopeChoice,
  type Clock,
} from "../security/patLifecycle.js";
import { interpretAmbiguousWorkweekText } from "../planning/scheduleParse.js";
import type { ClosePolicy, HuCreationPolicy, LinkyProfile } from "../types.js";

export type OnboardingAnswers = {
  organizationUrl: string;
  /** Obligatorio — nunca inferir. */
  project: string;
  team?: string;
  pat: string;
  defaultTags?: string[];
  /** Asignado (Assigned To) */
  assignedDisplayName?: string;
  assignedEmail?: string;
  /** Responsable separado */
  responsibleDisplayName?: string;
  responsibleTag?: string;
  responsibleMention?: string;
  occupation: string;
  projectContext: string;
  titleConvention?: string;
  huCreation: HuCreationPolicy;
  huRefine?: HuCreationPolicy;
  taskDelivery: ClosePolicy;
  taskClose: ClosePolicy;
  huClose: ClosePolicy;
  mondayToThursday?: { start: string; end: string };
  friday?: { start: string; end: string };
  /** Obligatorio preguntar */
  lunchMinutes: number;
  lunchStart?: string;
  lunchEnd?: string;
  /** Debe ser true tras mostrar interpretación lun-jue/vie */
  confirmScheduleInterpretation: boolean;
  ambiguousScheduleText?: string;
  holidays?: string[];
  absences?: string[];
  patCreatedOn?: string;
  patExpiresOn: string;
  deviceTimeZone?: string;
  confirmDeviceTimeZone?: boolean;
  scopeChoice?: PatScopeChoice;
  fullAccessAcknowledged?: boolean;
  localOsReminderOptIn?: boolean;
  planningMarginPercent?: number;
};

export const ONBOARDING_QUESTIONS: Array<{ id: string; prompt: string; once: true }> = [
  { id: "organizationUrl", prompt: "URL org Azure (https://dev.azure.com/{org} o https://{org}.visualstudio.com)", once: true },
  { id: "project", prompt: "Nombre EXACTO del proyecto Azure (obligatorio; no se infiere)", once: true },
  { id: "pat", prompt: "PAT Azure (entrada oculta → keyring). Necesario para trabajar.", once: true },
  { id: "occupation", prompt: "¿A qué te dedicas / rol? (para redactar HU y Tasks contextualizadas)", once: true },
  { id: "projectContext", prompt: "¿De qué trata el proyecto? (contexto de dominio, obligatorio)", once: true },
  { id: "assignedDisplayName", prompt: "Persona asignada (System.AssignedTo)", once: true },
  { id: "responsibleTag", prompt: "Tag del responsable (System.Tags) — separado de Assigned To", once: true },
  { id: "responsibleMention", prompt: "Mención del responsable en descripción (opcional, distinta del tag)", once: true },
  { id: "huCreation", prompt: "¿Quién CREA las HU? user_or_ai_with_approval | scrum_or_third_party_only", once: true },
  { id: "huRefine", prompt: "¿Quién REFINA las HU? (misma o distinta política)", once: true },
  { id: "schedule", prompt: "Confirmar horario: lun–jue 08:30–18:00 y viernes 08:00–17:00 (interpretación del texto ambiguo)", once: true },
  { id: "lunchMinutes", prompt: "¿Cuánto dura el almuerzo (minutos)? Obligatorio; no inventar.", once: true },
  { id: "patExpiresOn", prompt: "Vencimiento PAT YYYY-MM-DD (user-reported; recomendado crear el PAT a 90 días)", once: true },
  { id: "scopeChoice", prompt: "Scopes: full_access (recomendado, ack requerido) | work_items_rw (mínimo)", once: true },
];

export async function runOnboarding(
  answers: OnboardingAnswers,
  deps: {
    createClient: (org: string, project: string, pat: string) => AzureClient;
    dataDir?: string;
    workItemTypes?: string[];
    secretStore?: SecretStore;
    secretFallbackBackend?: "env" | "session";
    clock?: Clock;
    nowMs?: number;
  },
): Promise<{
  profile: LinkyProfile;
  profilePath: string;
  permissionNotes: string[];
  fieldNotes: string[];
  secretBackend: string;
  fullAccessWarning?: string;
  scheduleSummary: string;
}> {
  if (!answers.project?.trim()) throw new Error("project es obligatorio en setup; no hay default.");
  if (!answers.occupation?.trim()) throw new Error("occupation es obligatorio.");
  if (!answers.projectContext?.trim()) throw new Error("projectContext es obligatorio.");
  if (answers.lunchMinutes == null || answers.lunchMinutes < 0) {
    throw new Error("lunchMinutes es obligatorio (pregunta de almuerzo; no inventar).");
  }
  if (answers.confirmScheduleInterpretation !== true) {
    throw new Error(
      "Debes confirmar la interpretación del horario (lun–jue 08:30–18:00 / viernes 08:00–17:00) con confirmScheduleInterpretation=true.",
    );
  }

  const org = validateOrganizationUrl(answers.organizationUrl);
  if (!answers.pat.trim()) throw new Error("PAT requerido.");
  if (!answers.patExpiresOn?.trim()) throw new Error("patExpiresOn obligatorio (user-reported).");

  const ambiguous = interpretAmbiguousWorkweekText(
    answers.ambiguousScheduleText ??
      "lunes a viernes 8:30–18 y viernes 8–17",
  );
  const mondayToThursday = answers.mondayToThursday ?? ambiguous.interpretation.mondayToThursday;
  const friday = answers.friday ?? ambiguous.interpretation.friday;

  const detectedTz = detectDeviceTimeZone();
  const tz = answers.deviceTimeZone?.trim() || detectedTz;
  if (answers.deviceTimeZone && answers.deviceTimeZone !== detectedTz && answers.confirmDeviceTimeZone !== true) {
    throw new Error(
      `deviceTimeZone (${answers.deviceTimeZone}) difiere de la detectada (${detectedTz}). Confirma confirmDeviceTimeZone=true.`,
    );
  }

  const scopeChoice: PatScopeChoice = answers.scopeChoice ?? "work_items_rw";
  const life = validatePatLifecycleInput({
    createdOn: answers.patCreatedOn,
    expiresOn: answers.patExpiresOn,
    deviceTimeZone: tz,
    scopeChoice,
    fullAccessAcknowledged: answers.fullAccessAcknowledged,
    clock: deps.clock,
    nowMs: deps.nowMs,
  });
  if (!life.ok) throw new Error(life.errors.join(" | "));

  const saved = await saveAzurePat(answers.pat, {
    store: deps.secretStore,
    fallbackBackend: deps.secretFallbackBackend,
    dataDir: deps.dataDir,
  });

  const client = deps.createClient(org.organizationUrl, answers.project, answers.pat);
  const probe = await client.probePermissions();
  if (!probe.canRead) throw new Error(`Sin acceso de lectura: ${probe.notes.join(" ")}`);

  const types = deps.workItemTypes ?? ["Task", "User Story"];
  const processCache: LinkyProfile["processCache"] = {};
  const fieldNotes: string[] = [];
  for (const tName of types) {
    try {
      const meta = await detectProcessMeta(client, tName);
      processCache[tName] = meta;
      fieldNotes.push(`--- ${tName} ---`, ...summarizeFieldAvailability(meta.fields));
    } catch (e) {
      fieldNotes.push(`No se pudo detectar metadata de ${tName}: ${(e as Error).message}`);
    }
  }

  const schedule = defaultSchedule();
  schedule.timezone = tz === "America/Bogota" || !answers.deviceTimeZone ? "America/Bogota" : tz;
  schedule.mondayToThursday = mondayToThursday;
  schedule.friday = friday;
  schedule.lunchAsked = true;
  schedule.lunchMinutes = answers.lunchMinutes;
  schedule.lunchStart = answers.lunchStart;
  schedule.lunchEnd = answers.lunchEnd;
  schedule.scheduleInterpretationConfirmed = true;
  schedule.holidays = answers.holidays ?? [];
  schedule.absences = answers.absences ?? [];

  const tags = [
    ...(answers.defaultTags ?? []),
    ...(answers.responsibleTag ? [answers.responsibleTag] : []),
  ].filter(Boolean);

  const profile = buildProfile({
    azure: {
      organizationUrl: org.organizationUrl,
      project: answers.project.trim(),
      team: answers.team,
      identityDisplayName: answers.assignedDisplayName,
      identityEmail: answers.assignedEmail,
      defaultTags: tags,
    },
    responsibility: {
      assignedDisplayName: answers.assignedDisplayName,
      assignedEmail: answers.assignedEmail,
      responsibleDisplayName: answers.responsibleDisplayName,
      responsibleTag: answers.responsibleTag,
      responsibleMention: answers.responsibleMention,
    },
    workContext: {
      occupation: answers.occupation.trim(),
      projectContext: answers.projectContext.trim(),
      titleConvention: answers.titleConvention,
    },
    huCreation: answers.huCreation,
    huRefine: answers.huRefine ?? answers.huCreation,
    taskDelivery: answers.taskDelivery,
    taskClose: answers.taskClose,
    huClose: answers.huClose,
    schedule,
    estimate: {
      ...defaultEstimate(),
      planningMarginPercent: answers.planningMarginPercent ?? 10,
    },
    evidence: defaultEvidence(),
    description: defaultDescription(),
    lastPermissionProbe: {
      ...probe,
      canCreateWorkItems: false,
      canUpdateWorkItems: false,
      canChangeState: false,
      notes: [
        ...probe.notes,
        `${patStatusLabel(true)} vía ${saved.backend}.`,
        "Estados por defecto: planeación / en curso / entregado. Cierre solo con intención explícita + aprobación separada.",
      ],
    },
    processCache,
    secretBackend: saved.backend,
    patLifecycle: {
      ...life.value,
      localOsReminderOptIn: answers.localOsReminderOptIn === true,
    },
  });

  const path = await persist(profile, deps.dataDir);
  return {
    profile,
    profilePath: path,
    permissionNotes: probe.notes,
    fieldNotes,
    secretBackend: saved.backend,
    fullAccessWarning: scopeChoice === "full_access" ? FULL_ACCESS_WARNING : undefined,
    scheduleSummary: ambiguous.summary,
  };
}
