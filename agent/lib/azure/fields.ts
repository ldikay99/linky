import type { AzureClient } from "./client.js";
import type { FieldMeta, ProcessMeta } from "../types.js";

/** Campos conocidos de referencia documental (validar siempre con metadata del proyecto). */
export const DOCUMENTED_FIELD_CANDIDATES = [
  "System.Title",
  "System.Description",
  "System.Tags",
  "System.AssignedTo",
  "System.IterationPath",
  "System.AreaPath",
  "System.State",
  "System.History",
  "Microsoft.VSTS.Common.Activity",
  "Microsoft.VSTS.Common.Priority",
  "Microsoft.VSTS.Scheduling.OriginalEstimate",
  "Microsoft.VSTS.Scheduling.CompletedWork",
  "Custom.SubActividad",
  "Custom.TicketAsociado",
  "Custom.FechadeEntregaReal",
] as const;

export async function detectProcessMeta(client: AzureClient, typeName: string): Promise<ProcessMeta> {
  return client.getProcessMeta(typeName);
}

export function pickWritableFields(meta: ProcessMeta, desired: Record<string, unknown>): {
  applied: Record<string, unknown>;
  skipped: string[];
  missingRequired: string[];
} {
  const byRef = new Map(meta.fields.map((f) => [f.referenceName, f]));
  const applied: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(desired)) {
    const field = byRef.get(key);
    if (!field) {
      skipped.push(`${key} (no existe en este proceso/proyecto)`);
      continue;
    }
    if (field.readOnly) {
      skipped.push(`${key} (solo lectura)`);
      continue;
    }
    applied[key] = value;
  }
  const missingRequired = meta.fields
    .filter((f) => f.required && !f.readOnly && applied[f.referenceName] === undefined)
    .map((f) => f.referenceName);
  return { applied, skipped, missingRequired };
}

export function fieldsToJsonPatch(fields: Record<string, unknown>): Array<{ op: string; path: string; value: unknown }> {
  return Object.entries(fields).map(([ref, value]) => ({
    op: "add",
    path: `/fields/${ref}`,
    value,
  }));
}

export function summarizeFieldAvailability(fields: FieldMeta[]): string[] {
  const known = new Set(DOCUMENTED_FIELD_CANDIDATES);
  const present = fields.filter((f) => known.has(f.referenceName as (typeof DOCUMENTED_FIELD_CANDIDATES)[number]));
  const absent = DOCUMENTED_FIELD_CANDIDATES.filter((c) => !fields.some((f) => f.referenceName === c));
  return [
    `Campos documentados presentes: ${present.map((f) => f.referenceName).join(", ") || "(ninguno)"}`,
    `Campos documentados ausentes (no usar): ${absent.join(", ") || "(ninguno)"}`,
  ];
}
