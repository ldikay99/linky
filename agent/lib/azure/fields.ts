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
    if (field.allowedValues?.length && !field.allowedValues.includes(String(value))) {
      skipped.push(`${key}="${String(value)}" (no es un valor permitido: ${field.allowedValues.join(" / ")})`);
      continue;
    }
    applied[key] = value;
  }
  // Azure completa solo: campos con default del proceso, e Iteración/Área desde su ruta (o la raíz del proyecto).
  const satisfiedBySystem = (ref: string) =>
    (ref === "System.IterationId" && applied["System.IterationPath"] !== undefined) ||
    (ref === "System.AreaId" && applied["System.AreaPath"] !== undefined);
  const missingRequired = meta.fields
    .filter(
      (f) =>
        f.required &&
        !f.readOnly &&
        applied[f.referenceName] === undefined &&
        f.defaultValue == null &&
        !satisfiedBySystem(f.referenceName),
    )
    .map((f) => f.referenceName);
  return { applied, skipped, missingRequired };
}

/**
 * Para campos obligatorios sin valor, toma el más usado entre las Tasks hermanas (mismo padre).
 * Así se respetan convenciones del equipo (p. ej. Activity / SubActividad) sin inventar valores.
 */
export async function inferFromSiblings(
  client: AzureClient,
  siblingIds: number[],
  fields: string[],
  max = 10,
): Promise<Record<string, unknown>> {
  const counts = new Map<string, Map<string, { value: unknown; n: number }>>();
  for (const id of [...siblingIds].sort((a, b) => b - a).slice(0, max)) {
    let wi;
    try {
      wi = await client.getWorkItem(id);
    } catch {
      continue;
    }
    for (const ref of fields) {
      const v = wi.fields[ref];
      if (v === undefined || v === null || v === "") continue;
      const byValue = counts.get(ref) ?? new Map();
      const k = JSON.stringify(v);
      byValue.set(k, { value: v, n: (byValue.get(k)?.n ?? 0) + 1 });
      counts.set(ref, byValue);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [ref, byValue] of counts) {
    out[ref] = [...byValue.values()].sort((a, b) => b.n - a.n)[0].value;
  }
  return out;
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
