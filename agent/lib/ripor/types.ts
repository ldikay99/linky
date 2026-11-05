/** Tipos Ripor — https://ripor.co/u/horas (formulario web vía HTTP o UI). */

export const RIPOR_PUBLIC_URL = "https://ripor.co/u/horas" as const;

export type RiporWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sun=0 … Sat=6

export type RiporScheduleConfig = {
  /** Lun–Jue: inicio HH:MM local dispositivo */
  monThuStart: string;
  monThuEnd: string;
  /** Viernes */
  friStart: string;
  friEnd: string;
  /** Pausa comida explícita (informativa; dedicación es numérica). */
  lunchBreakLabel: string;
  /** Dedicación exacta esperada Lun–Jue */
  expectedHoursMonThu: number;
  /** Dedicación exacta Viernes */
  expectedHoursFriday: number;
};

export const DEFAULT_RIPOR_SCHEDULE: RiporScheduleConfig = {
  monThuStart: "08:30",
  monThuEnd: "18:00",
  friStart: "08:00",
  friEnd: "17:00",
  lunchBreakLabel: "pausa comida",
  expectedHoursMonThu: 8.5,
  expectedHoursFriday: 8,
};

/** Proyecto de área Ripor (distinto de proyectos Azure). */
export type RiporAreaProject = {
  label: string;
  /** ID interno solo si se observa en UI; nunca inventar del ejemplo. */
  uiValue?: string;
  verifiedFromUi: boolean;
  /** IDs del formulario (modo HTTP). Solo desde catálogo/reporte real de la cuenta. */
  projectId?: number;
  analyticAccountId?: number;
  code?: string;
};

export type RiporTaskOption = {
  label: string;
  uiValue?: string;
  verifiedFromUi: boolean;
};

export type RiporTransportOption = {
  label: string;
  /** Valor de formulario si se conoce desde UI observada */
  formValue?: string;
  verifiedFromUi: boolean;
};

export type RiporProfile = {
  version: 1;
  publicUrl: typeof RIPOR_PUBLIC_URL;
  /** Proyecto de área confirmado por el usuario entre opciones UI reales */
  areaProject?: RiporAreaProject;
  /** Tarea por defecto: "Tarea personalizada" salvo override explícito */
  defaultTaskLabel: string;
  schedule: RiporScheduleConfig;
  /** Medio de transporte setup una vez */
  defaultTransport?: RiporTransportOption;
  /** Proyectos Azure (referencia; no se envían como proyecto Ripor) */
  azureProjectHints: string[];
  /** Catálogo de tareas (uiValue = report_task_id) para overrides explícitos. */
  taskOptions?: RiporTaskOption[];
  /** Catálogo de transportes (formValue = valor medio_transporte) para override diario. */
  transportOptions?: RiporTransportOption[];
  setupComplete: boolean;
  /** Tope de la descripción breve (default 500; Ripor exige mínimo 50). */
  descriptionMaxChars?: number;
  notes?: string[];
};

export type RiporExistingReport = {
  id: string;
  dateYmd: string;
  hours: number;
  description?: string;
  evidenceUrls?: string[];
  taskLabel?: string;
  transportLabel?: string;
  areaProjectLabel?: string;
};

export type RiporDraftFields = {
  dateYmd: string;
  areaProjectLabel: string;
  taskLabel: string;
  /** Dedicación numérica (campo horas). No inventar timestamps UI. */
  hours: number;
  description: string;
  evidenceUrls: string[];
  transportLabel: string;
  /** Override diario de transporte; no reescribe default del perfil */
  transportIsDailyOverride: boolean;
  /**
   * Menos horas solo si petición explícita limitada a fecha+cantidad.
   * dateYmd DEBE coincidir con la fecha de la mutación (vinculada).
   */
  explicitUnderHoursRequest?: { dateYmd: string; hours: number; reason?: string };
  /** Ausencia / festivo / sin trabajo: no crear inventando */
  skipDay?: boolean;
  skipReason?: string;
};

/** Prueba positiva de cobertura (no confiar solo en flags editables). */
export type RiporCoverageProof = {
  /** Horas de actividades Azure confirmadas que sustentan ESTE draft (sin duplicar otros reportes). */
  sustainedActivityHours: number;
  /** Literal true: el llamador atestigua cobertura del draft; el núcleo aún exige sustained >= draft.hours. */
  coversDraftDedication: true;
  source: "azure_confirmed";
};

export type RiporMutationOp = "create" | "update" | "delete";

export type RiporPreview = {
  op: RiporMutationOp;
  dateYmd: string;
  publicUrl: typeof RIPOR_PUBLIC_URL;
  fields?: RiporDraftFields;
  before?: RiporExistingReport;
  after?: Partial<RiporExistingReport>;
  reportId?: string;
  existingHoursSameDay: number;
  proposedTotalHours: number;
  expectedHoursForDay: number;
  snapshotHash: string;
  policyNotes: string[];
  blockers: string[];
  /** Affirmación de cobertura hasheada; reutilizar en apply (no editar a mano). */
  coverageProof?: RiporCoverageProof;
  activitiesCoverFullDay?: boolean;
};

export type RiporApproval = {
  op: RiporMutationOp;
  snapshotHash: string;
  dateYmd: string;
  reportId?: string;
  /** Confirmación separada obligatoria para delete */
  deleteConfirmed?: boolean;
};

export type RiporJournalEntry = {
  id: string;
  at: string;
  op: RiporMutationOp;
  dateYmd: string;
  status: "pending" | "ok" | "failed" | "unknown";
  snapshotHash: string;
  reportId?: string;
  message?: string;
};
