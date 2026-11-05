import type {
  RiporAreaProject,
  RiporProfile,
  RiporScheduleConfig,
  RiporTaskOption,
  RiporTransportOption,
} from "./types.js";
import { DEFAULT_RIPOR_SCHEDULE, RIPOR_PUBLIC_URL } from "./types.js";

export type RiporSetupInput = {
  /** Opciones REALES observadas en UI (nunca inventar IDs de ejemplo). */
  uiAreaProjects: RiporAreaProject[];
  /** Label elegido y confirmado por el usuario */
  chosenAreaProjectLabel: string;
  uiTaskOptions?: RiporTaskOption[];
  /** Override explícito; default Tarea personalizada si UI lo confirma */
  chosenTaskLabel?: string;
  uiTransportOptions: RiporTransportOption[];
  chosenTransportLabel: string;
  azureProjectHints?: string[];
  schedule?: Partial<RiporScheduleConfig>;
  /** Si UI aún no observada, marcar verifiedFromUi=false */
  uiObserved: boolean;
};

export type RiporSetupResult = {
  ok: boolean;
  profile?: RiporProfile;
  errors: string[];
  warnings: string[];
};

/**
 * Setup distingue:
 * - proyecto/área Ripor (mandatory, de opciones UI)
 * - uno/múltiples proyectos Azure (hints; no son el campo Ripor)
 */
export function buildRiporProfileFromSetup(input: RiporSetupInput): RiporSetupResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.uiObserved) {
    warnings.push(
      "UI Ripor no verificada aún (read-only observation pendiente). Opciones pueden ser mock/no verificadas.",
    );
  }

  if (!input.uiAreaProjects.length) {
    errors.push("Se requieren opciones reales de proyecto de área desde UI (o mock marcado no verificado).");
  }

  const chosen = input.uiAreaProjects.find((p) => p.label === input.chosenAreaProjectLabel);
  if (!chosen) {
    errors.push(
      `Proyecto de área "${input.chosenAreaProjectLabel}" no está en opciones UI. Nunca usar default IDs de ejemplo.`,
    );
  } else if (!chosen.verifiedFromUi) {
    warnings.push(`Proyecto de área "${chosen.label}" no verificado en UI real.`);
  }

  const taskLabel = input.chosenTaskLabel?.trim() || "Tarea Personalizada";
  if (input.uiTaskOptions?.length) {
    const t = input.uiTaskOptions.find((x) => x.label === taskLabel);
    if (!t) {
      errors.push(`Tarea "${taskLabel}" no está en opciones UI observadas.`);
    } else if (!t.verifiedFromUi) {
      warnings.push(`Tarea "${taskLabel}" no verificada en UI real.`);
    }
  } else {
    warnings.push('Label de tarea por defecto "Tarea Personalizada" — confirmar en UI (observado genérico).');
  }

  if (!input.uiTransportOptions.length) {
    errors.push("Se requieren opciones de medio de transporte observadas (o mock marcado).");
  }
  const transport = input.uiTransportOptions.find((t) => t.label === input.chosenTransportLabel);
  if (!transport) {
    errors.push(`Transporte "${input.chosenTransportLabel}" no está en opciones.`);
  } else if (!transport.verifiedFromUi) {
    warnings.push(`Transporte "${transport.label}" no verificado en UI real.`);
  }

  if (errors.length) return { ok: false, errors, warnings };

  const schedule: RiporScheduleConfig = {
    ...DEFAULT_RIPOR_SCHEDULE,
    ...input.schedule,
  };

  const profile: RiporProfile = {
    version: 1,
    publicUrl: RIPOR_PUBLIC_URL,
    areaProject: chosen!,
    defaultTaskLabel: taskLabel,
    schedule,
    defaultTransport: transport!,
    azureProjectHints: input.azureProjectHints ?? [],
    taskOptions: input.uiTaskOptions,
    transportOptions: input.uiTransportOptions,
    setupComplete: true,
    notes: [
      "Proyecto Ripor (área) ≠ proyectos Azure.",
      "Medio de transporte: setup una vez; override diario no reescribe este default.",
      ...warnings,
    ],
  };

  return { ok: true, profile, errors: [], warnings };
}

export function emptyRiporProfile(): RiporProfile {
  return {
    version: 1,
    publicUrl: RIPOR_PUBLIC_URL,
    defaultTaskLabel: "Tarea Personalizada",
    schedule: { ...DEFAULT_RIPOR_SCHEDULE },
    azureProjectHints: [],
    setupComplete: false,
    notes: ["Setup incompleto: elegir proyecto de área y transporte desde UI."],
  };
}
