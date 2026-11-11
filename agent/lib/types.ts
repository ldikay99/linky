import type { PatLifecycleProfile } from "./security/patLifecycle.js";
export type { PatLifecycleProfile };

/** Tipos compartidos del núcleo Linky (sin secretos). */
export type WorkItemKind = "User Story" | "Task" | "Bug" | string;

export type HuCreationPolicy =
  | "user_or_ai_with_approval"
  | "scrum_or_third_party_only";

export type ClosePolicy =
  | "same_user"
  | "scrum_or_third_party"
  | "ask_each_time";

export type WorkdayHours = {
  /** HH:mm */
  start: string;
  end: string;
};

export type ScheduleProfile = {
  timezone: string; // IANA; tipicamente America/Bogota
  mondayToThursday: WorkdayHours;
  friday: WorkdayHours;
  /** Obligatoria en onboarding: no inventar. */
  lunchAsked: true;
  lunchMinutes: number;
  lunchStart?: string;
  lunchEnd?: string;
  /** Interpretación confirmada del texto ambiguo lun-vie. */
  scheduleInterpretationConfirmed: boolean;
  holidays: string[];
  absences: string[];
};

/** Contexto para redactar/refinar HU y Tasks (sin secretos). */
export type WorkContextProfile = {
  /** A qué se dedica la persona (ocupación/rol). */
  occupation: string;
  /** Descripción del proyecto / dominio (obligatoria; no inferir). */
  projectContext: string;
  /** Convención opcional de títulos (plantilla). */
  titleConvention?: string;
};

/**
 * Identidad asignada vs responsable (separados).
 * Tags ≠ menciones ≠ Assigned To.
 */
export type ResponsibilityProfile = {
  /** System.AssignedTo — persona asignada al work item. */
  assignedDisplayName?: string;
  assignedEmail?: string;
  /** Responsable (p. ej. líder): System.Tags y/o mención en Description — NO mezclar con AssignedTo. */
  responsibleDisplayName?: string;
  responsibleTag?: string;
  responsibleMention?: string;
};

export type EstimatePolicy = {
  /**
   * Margen "un poco más" solo sobre estimación a futuro, con referencia real confirmada.
   * Nunca altera CompletedWork retrospectivo.
   */
  planningMarginPercent: number; // p.ej. 10
  /** Requiere que el usuario apruebe aplicar el margen. */
  requireMarginApproval: true;
};

export type EvidencePolicy = {
  allowLinks: boolean;
  allowImages: boolean;
  maxImageBytes: number;
  allowedImageMime: string[];
  requireAccessNote: boolean;
};

export type DescriptionStyle = {
  planningTense: "future";
  executionTense: "past";
  maxChars: number;
  requireShortDirect: true;
};

export type AzureConnectionProfile = {
  organizationUrl: string;
  /** Obligatorio en setup; nunca default inferido. */
  project: string;
  team?: string;
  identityDisplayName?: string;
  identityEmail?: string;
  defaultTags: string[];
  /**
   * Valores por defecto para campos obligatorios del proceso al crear Tasks
   * (p. ej. Microsoft.VSTS.Common.Activity, Custom.SubActividad). Si faltan, se infieren de Tasks hermanas.
   */
  taskFieldDefaults?: Record<string, unknown>;
};

export type PermissionProbeResult = {
  canRead: boolean;
  canCreateWorkItems: boolean;
  canUpdateWorkItems: boolean;
  canChangeState: boolean;
  notes: string[];
};

export type FieldMeta = {
  referenceName: string;
  name: string;
  type: string;
  required: boolean;
  readOnly: boolean;
  allowedValues?: string[];
  /** Valor por defecto del proceso (Azure lo asigna si no se envía). */
  defaultValue?: unknown;
};

export type StateMeta = {
  name: string;
  category?: string;
};

export type ProcessMeta = {
  workItemType: string;
  fields: FieldMeta[];
  states: StateMeta[];
  transitions: Array<{ from: string; to: string }>;
};

export type LinkyProfile = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  azure: AzureConnectionProfile;
  responsibility: ResponsibilityProfile;
  workContext: WorkContextProfile;
  huCreation: HuCreationPolicy;
  /** Quién refina HU (puede coincidir con creación). */
  huRefine: HuCreationPolicy;
  taskDelivery: ClosePolicy;
  taskClose: ClosePolicy;
  huClose: ClosePolicy;
  /**
   * Cierre (Closed/Completed/Cerrado) NUNCA por defecto.
   * Requiere intención explícita del usuario + aprobación separada de close.
   */
  closeRequiresExplicitUserIntent: true;
  schedule: ScheduleProfile;
  estimate: EstimatePolicy;
  evidence: EvidencePolicy;
  description: DescriptionStyle;
  lastPermissionProbe?: PermissionProbeResult;
  processCache?: Record<string, ProcessMeta>;
  messaging: {
    mode: "draft_only" | "adapter_user_channel";
    sendStartOfDay: boolean;
    sendEndOfDay: boolean;
    schedulingEnabled: false;
  };
  secretBackend?: "keyring" | "env" | "session" | "vault";
  patLifecycle?: PatLifecycleProfile;
};

export type DayActivity = {
  id: string;
  kind: "planned" | "done";
  title: string;
  shortDescription: string;
  workItemId?: number;
  parentHuId?: number;
  workItemType: WorkItemKind;
  /** Minutos REALES dedicados (CompletedWork); no inventar. */
  minutesSpent?: number;
  /** Minutos de ESTIMACIÓN (OriginalEstimate); separado de reales. */
  minutesEstimate?: number;
  /** Usuario aprobó aplicar margen de planning a esta estimación. */
  estimateMarginApproved?: boolean;
  evidenceLinks: string[];
  evidenceImages: string[];
  meetingOrCallLinks: string[];
  notes?: string;
  expectedRev?: number;
  /** Solo cambiar el estado de un item existente (sin reescribir campos ni comentar). */
  stateOnly?: boolean;
  /** Valores explícitos de campos del proceso para esta actividad (ganan sobre defaults e inferencia). */
  fields?: Record<string, unknown>;
  /** Ventana HH:mm–HH:mm dentro de la jornada (opcional para cobertura). */
  timeRange?: { start: string; end: string };
};

export type DayPlan = {
  date: string;
  activities: DayActivity[];
  missingQuestions: string[];
  warnings: string[];
  coverage?: {
    requiredMinutes: number;
    coveredMinutes: number;
    gaps: Array<{ start: string; end: string; minutes: number }>;
    overlaps: Array<{ a: string; b: string }>;
  };
};

export type AttachmentPlan = {
  localPath: string;
  fileName: string;
  contentType: string;
  byteLength: number;
};

export type PlannedChange =
  | {
      op: "create";
      clientKey: string;
      workItemType: WorkItemKind;
      fields: Record<string, unknown>;
      relations?: Array<{ rel: string; url: string }>;
      attachments?: AttachmentPlan[];
      parentHuId?: number;
    }
  | {
      op: "update";
      workItemId: number;
      clientKey: string;
      fields: Record<string, unknown>;
      comment?: string;
      relations?: Array<{ rel: string; url: string }>;
      attachments?: AttachmentPlan[];
      expectedRev?: number;
    }
  | {
      op: "transition";
      workItemId: number;
      clientKey: string;
      fromState?: string;
      toState: string;
      comment?: string;
      intent?: "entregado" | "cerrado" | "en_curso" | "planeado";
      workItemTypeHint?: string;
      /** Solo para intent=cerrado: intención explícita del usuario en ESTA acción. */
      userExplicitCloseIntent?: boolean;
      /** Aprobación SEPARADA de cierre (no vale el approve general de apply). */
      explicitCloseApproved?: boolean;
      expectedRev?: number;
    };

export type ApplyPreview = {
  generatedAt: string;
  changes: PlannedChange[];
  humanSummary: string[];
  requiresExplicitApproval: true;
  snapshotHash: string;
};

export type ApplyResult = {
  applied: Array<{ clientKey: string; workItemId: number; action: string }>;
  skippedIdempotent: string[];
  blocked: Array<{ clientKey: string; reason: string }>;
  errors: Array<{ clientKey: string; message: string }>;
  needsReconcile: string[];
};
