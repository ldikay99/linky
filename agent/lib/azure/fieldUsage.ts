/**
 * Qué campos llena el equipo de la persona en un tipo de work item (Task, HU…), leído de items reales de referencia
 * (las hermanas bajo la misma HU, o los que la persona indique). No copia valores: le muestra a la IA cada campo que
 * debe considerar, para que ninguno quede vacío por descuido. Sirve para cualquier proceso y área.
 */
import type { ProcessMeta } from "../types.js";
import type { WorkItem } from "./client.js";

export type FieldUsage = {
  referenceName: string;
  name: string;
  type: string;
  required: boolean;
  allowedValues?: string[];
  /** Cuántas referencias lo traen lleno, de cuántas. */
  filled: number;
  of: number;
  /** Ejemplo corto (texto plano) para entender CÓMO se llena; no para copiarlo. */
  example?: string;
};

// Los pone Azure solo o se manejan aparte (estado, relaciones).
const AUTOMATIC = /^(System\.(Id|Rev|Watermark|CreatedDate|CreatedBy|ChangedDate|ChangedBy|AuthorizedDate|AuthorizedAs|RevisedDate|Reason|State|BoardColumn|BoardColumnDone|BoardLane|CommentCount|TeamProject|WorkItemType|NodeName|AreaId|IterationId|PersonId|Parent|ExternalLinkCount|HyperLinkCount|AttachedFileCount|RelatedLinkCount|RemoteLinkCount|AreaLevel\d+|IterationLevel\d+)|Microsoft\.VSTS\.Common\.(StateChangeDate|ActivatedDate|ActivatedBy|ResolvedDate|ResolvedBy|ResolvedReason|ClosedDate|ClosedBy)|WEF_)/;

function plain(v: unknown): string {
  const s = typeof v === "object" && v ? String((v as { displayName?: string }).displayName ?? JSON.stringify(v)) : String(v);
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && plain(v) === "");

export function fieldUsage(meta: ProcessMeta, references: WorkItem[]): FieldUsage[] {
  const out: FieldUsage[] = [];
  for (const f of meta.fields) {
    if (f.readOnly || AUTOMATIC.test(f.referenceName)) continue;
    const values = references.map((r) => r.fields[f.referenceName]).filter((v) => !isEmpty(v));
    if (!f.required && !values.length) continue;
    const sample = values.length ? plain(values[values.length - 1]) : undefined;
    out.push({
      referenceName: f.referenceName,
      name: f.name,
      type: f.type,
      required: f.required,
      allowedValues: f.allowedValues?.length ? f.allowedValues : undefined,
      filled: values.length,
      of: references.length,
      example: sample ? (sample.length > 160 ? `${sample.slice(0, 160)}…` : sample) : undefined,
    });
  }
  return out.sort((a, b) => Number(b.required) - Number(a.required) || b.filled - a.filled);
}

/** Campos que la mayoría de las referencias llena y el cambio propuesto deja vacíos. */
export function commonlyFilledButMissing(usage: FieldUsage[], desired: Record<string, unknown>, threshold = 0.5): FieldUsage[] {
  return usage.filter((u) => u.of > 0 && u.filled / u.of >= threshold && isEmpty(desired[u.referenceName]));
}
