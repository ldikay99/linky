/**
 * Herramientas de Linky para el chat: las mismas del servidor MCP más las propias de la web.
 * Las escrituras NO tienen ejecución directa: el modelo solo las solicita y la interfaz le muestra a la
 * persona el preview con Aprobar/Rechazar. El modelo nunca ve ni puede fijar "approved".
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { jsonSchema, tool, type ToolSet } from "ai";
import { TOOLS, jsonSchema as linkySchema, type ToolDef } from "../../../agent/lib/mcp/tools.js";
import type { Files } from "../files/files.js";
import type { Memory } from "../memory/memory.js";
import type { StoredHistory, UserRow } from "../store/db.js";
import { cli, serializedFor, withTempJson, type Workspace } from "./workspace.js";

export const LABELS: Record<string, string> = {
  linky_welcome: "Bienvenida",
  linky_doctor: "Revisando conexiones",
  linky_day: "Revisando tu día",
  linky_alerts: "Buscando avisos",
  linky_cleanup: "Cerrando navegadores huérfanos",
  ripor_month: "Revisando el mes en Ripor",
  ripor_list: "Leyendo reportes de Ripor",
  ripor_suggest: "Armando sugerencia para Ripor",
  ripor_preview: "Preparando el reporte de Ripor",
  ripor_apply: "Registrando en Ripor",
  ripor_delete_preview: "Preparando borrado en Ripor",
  ripor_reconcile: "Reconciliando Ripor",
  azure_orgs: "Leyendo organizaciones de Azure",
  azure_activity: "Leyendo tu actividad en Azure",
  azure_hus: "Buscando HU abiertas",
  azure_ceco: "Buscando el código de proyecto",
  azure_fields: "Leyendo campos del equipo",
  azure_style: "Leyendo tu estilo de HU y Tasks",
  azure_hours: "Calculando horas por Task",
  azure_hours_apply: "Registrando horas en Azure",
  azure_delete: "Preparando borrado en Azure",
  azure_delete_confirm: "Enviando a la papelera de Azure",
  azure_day_preview: "Preparando cambios en Azure",
  azure_day_apply: "Aplicando cambios en Azure",
  calendar_day: "Leyendo reuniones",
  calendar_meetings: "Leyendo eventos del calendario",
  calendar_confirm: "Marcando reunión de trabajo",
  calendar_ignore: "Marcando evento general",
  calendar_download: "Descargando adjuntos de reuniones",
  mail_day: "Leyendo correos",
  dev_day: "Leyendo commits y PRs",
  dev_repos: "Leyendo repositorios",
  chat_read: "Leyendo el chat de reporte",
  chat_draft: "Redactando mensaje",
  chat_send: "Enviando a Google Chat",
  attachment_path: "Preparando evidencia adjunta",
  memoria_guardar: "Guardando en la memoria",
  memoria_buscar: "Buscando en la memoria",
};

/** Escrituras que esperan aprobación y el preview que la persona debe haber visto. */
export const APPROVALS: Record<string, { previews: string[]; title: string }> = {
  ripor_apply: { previews: ["ripor_preview", "ripor_delete_preview"], title: "Registrar en Ripor" },
  azure_hours_apply: { previews: ["azure_hours"], title: "Registrar horas en Azure" },
  azure_day_apply: { previews: ["azure_day_preview"], title: "Crear y actualizar en Azure" },
  azure_delete_confirm: { previews: ["azure_delete"], title: "Enviar a la papelera de Azure" },
  chat_send: { previews: ["chat_draft"], title: "Enviar mensaje a Google Chat" },
};

const PREVIEW_TOOLS = new Set(Object.values(APPROVALS).flatMap((a) => a.previews));
const HIDDEN_PROPS = new Set(["approved", "approved_by"]);
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export type ToolContext = {
  user: UserRow;
  conversationId: string;
  ws: Workspace;
  files: Files;
  memory: Memory;
  history: StoredHistory;
  signal?: AbortSignal;
};

export type ToolOutcome = { ok: boolean; text: string };

const clip = (s: string, n = 60_000) => (s.length > n ? `${s.slice(0, n)}\n…(recortado)` : s);

async function runDef(def: ToolDef, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const args = def.toArgs(input);
  const exec = () => cli(ctx.ws, args, { timeoutMs: def.timeoutMs, signal: ctx.signal });
  const r = await (def.browser ? serializedFor(ctx.user.id, exec) : exec());
  return { ok: r.ok, text: r.text };
}

/** Evidencias del plan del día: solo archivos que la persona adjuntó en la web (nunca rutas arbitrarias). */
function assertEvidenceInside(day: unknown, root: string) {
  const acts = (day as { activities?: Array<{ evidenceImages?: unknown }> })?.activities ?? [];
  for (const a of acts) {
    for (const p of Array.isArray(a.evidenceImages) ? a.evidenceImages : []) {
      const rel = path.relative(root, path.resolve(String(p)));
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Las fotos de evidencia deben venir de adjuntos (usa attachment_path).");
    }
  }
}

const evidenceRoot = (ctx: ToolContext) => path.join(ctx.ws.scratchDir, "evidence");

/** Ejecuta cualquier herramienta de lectura o preview (también la usa el modo sin IA). */
export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  let out: ToolOutcome;
  if (name === "azure_day_preview") {
    assertEvidenceInside(input.day, evidenceRoot(ctx));
    const outFile = path.join(ctx.ws.scratchDir, `preview-${randomUUID()}.json`);
    out = await withTempJson(ctx.ws, input.day, async (dayFile) => {
      const args = ["preview", "--day", dayFile, "--out", outFile];
      if (input.intents && typeof input.intents === "object") args.push("--intents", JSON.stringify(input.intents));
      if (input.allow_hu_create === true) args.push("--allow-hu-create");
      const r = await cli(ctx.ws, args, { timeoutMs: 300_000, signal: ctx.signal });
      return { ok: r.ok, text: r.text };
    });
    if (out.ok) ctx.history.dayPreviewFile = outFile;
  } else if (name === "memoria_guardar") {
    const r = await ctx.memory.remember(ctx.user.id, String(input.texto ?? ""));
    out = r.ok
      ? { ok: true, text: r.duplicate ? "Ya lo tenía guardado." : "Guardado en la memoria de la persona." }
      : { ok: false, text: r.reason === "secreto" ? "No se guardó: parece un secreto (token, clave)." : "No se guardó: texto vacío." };
  } else if (name === "memoria_buscar") {
    const hits = await ctx.memory.search(ctx.user.id, String(input.consulta ?? ""), { k: 8, excludeConversation: ctx.conversationId });
    out = {
      ok: true,
      text: hits.length
        ? hits.map((h) => `- [${h.kind === "fact" ? "recuerdo" : "conversación anterior"} · ${new Date(h.createdAt).toISOString().slice(0, 10)}] ${h.text}`).join("\n")
        : "Sin resultados en la memoria.",
    };
  } else if (name === "attachment_path") {
    const f = await ctx.files.read(ctx.user.id, String(input.id ?? ""));
    if (!f) return { ok: false, text: "Adjunto no encontrado." };
    const dir = path.join(evidenceRoot(ctx), f.row.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, f.row.name);
    await writeFile(file, f.bytes, { mode: 0o600 });
    out = { ok: true, text: JSON.stringify({ path: file, name: f.row.name, mediaType: f.row.mediaType }) };
  } else {
    const def = BY_NAME.get(name);
    if (!def) return { ok: false, text: `Herramienta desconocida: ${name}` };
    if (APPROVALS[name]) return { ok: false, text: "Esta escritura requiere la aprobación de la persona." };
    out = await runDef(def, input, ctx);
  }
  if (PREVIEW_TOOLS.has(name) && out.ok) ctx.history.previews[name] = out.text;
  return out;
}

function snapshotOf(previewText: string | undefined): string | null {
  if (!previewText) return null;
  try {
    const j = JSON.parse(previewText) as Record<string, unknown>;
    const s = j.snapshotHash ?? j.snapshot ?? (j.preview as Record<string, unknown> | undefined)?.snapshotHash;
    return typeof s === "string" ? s : null;
  } catch {
    return /"snapshotHash"\s*:\s*"([^"]+)"/.exec(previewText)?.[1] ?? null;
  }
}

/** Preview que respalda una aprobación (lo último que la persona vio de ese tipo). */
export function approvalPreview(name: string, history: StoredHistory): string | undefined {
  for (const p of APPROVALS[name]?.previews ?? []) if (history.previews[p]) return history.previews[p];
  return undefined;
}

/** Ejecuta una escritura YA aprobada por la persona (clic en Aprobar). */
export async function runApproved(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const preview = approvalPreview(name, ctx.history);
  if (!preview) return { ok: false, text: "No hay un preview previo de esta escritura; primero hay que mostrarlo." };
  const expected = snapshotOf(preview);
  if (expected && input.snapshot !== undefined && input.snapshot !== expected) {
    return { ok: false, text: "El snapshot no coincide con el preview mostrado; se canceló por seguridad." };
  }
  const snapshot = String(input.snapshot ?? expected ?? "");
  const by = ctx.user.name;
  if (name === "azure_day_apply") {
    if (!ctx.history.dayPreviewFile) return { ok: false, text: "Falta el preview de Azure." };
    const r = await cli(ctx.ws, ["apply", "--preview", ctx.history.dayPreviewFile, "--approve", "--by", by, "--snapshot", snapshot], { timeoutMs: 300_000 });
    return { ok: r.ok, text: r.text };
  }
  if (name === "azure_delete_confirm") return runDef(BY_NAME.get("azure_delete")!, { id: input.id, approved: true }, ctx);
  const def = BY_NAME.get(name);
  if (!def) return { ok: false, text: `Herramienta desconocida: ${name}` };
  return runDef(def, { ...input, snapshot, approved: true, approved_by: by }, ctx);
}

function modelSchema(def: Pick<ToolDef, "properties" | "required">) {
  const base = linkySchema(def as ToolDef);
  const properties = Object.fromEntries(Object.entries(base.properties).filter(([k]) => !HIDDEN_PROPS.has(k)));
  return { ...base, properties, required: (base.required ?? []).filter((k) => !HIDDEN_PROPS.has(k)) };
}

const WEB_TOOLS: Array<{ name: string; description: string; schema: Record<string, unknown> }> = [
  {
    name: "azure_day_preview",
    description:
      "Preview de crear/actualizar HU y Tasks del día en Azure (mismo JSON de día que `linky preview --day`: {date, partialDay?, activities:[...]}). " +
      "Las fotos de evidencia (evidenceImages) deben ser rutas devueltas por attachment_path. Muestra humanSummary a la persona.",
    schema: {
      type: "object",
      properties: {
        day: { type: "object", description: "Plan del día: {date, partialDay?, activities[]}.", additionalProperties: true },
        intents: { type: "object", description: "Estado por id de actividad: entregado | cerrado | en_curso | planeado.", additionalProperties: { type: "string" } },
        allow_hu_create: { type: "boolean", description: "Permitir crear HU (solo si su política lo permite)." },
      },
      required: ["day"],
      additionalProperties: false,
    },
  },
  {
    name: "azure_day_apply",
    description: "Aplica el último preview de azure_day_preview. La interfaz le pide la aprobación a la persona; tú solo lo solicitas.",
    schema: { type: "object", properties: { snapshot: { type: "string", description: "snapshotHash del preview." } }, required: ["snapshot"], additionalProperties: false },
  },
  {
    name: "azure_delete_confirm",
    description: "Envía a la papelera el work item mostrado con azure_delete. La interfaz pide la aprobación a la persona.",
    schema: { type: "object", properties: { id: { type: "string", description: "ID del work item." } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "memoria_guardar",
    description:
      "Guarda algo estable sobre cómo trabajar para esta persona (preferencia, etiqueta, a quién mencionar, corrección que te hizo). " +
      "Una frase clara. Nunca secretos ni datos que ya viven en Azure o Ripor.",
    schema: { type: "object", properties: { texto: { type: "string", description: "Lo que hay que recordar (máx. 1000 caracteres)." } }, required: ["texto"], additionalProperties: false },
  },
  {
    name: "memoria_buscar",
    description: "Busca en los recuerdos de la persona y en sus conversaciones anteriores (p. ej. 'lo que hicimos con PQRD', 'qué etiqueta uso').",
    schema: { type: "object", properties: { consulta: { type: "string", description: "Qué buscar." } }, required: ["consulta"], additionalProperties: false },
  },
  {
    name: "attachment_path",
    description: "Ruta local de un adjunto de la conversación (por id) para usarlo como evidencia (p. ej. evidenceImages de una Task).",
    schema: { type: "object", properties: { id: { type: "string", description: "ID del adjunto." } }, required: ["id"], additionalProperties: false },
  },
];

/** Set de herramientas para el modelo. Las de aprobación no tienen execute: cortan el turno y esperan a la persona. */
export function buildToolSet(ctx: ToolContext): ToolSet {
  const set: ToolSet = {};
  const add = (name: string, description: string, schema: Record<string, unknown>) => {
    const needsApproval = Boolean(APPROVALS[name]);
    set[name] = needsApproval
      ? tool({ description, inputSchema: jsonSchema(schema as never) })
      : tool({
          description,
          inputSchema: jsonSchema(schema as never),
          execute: async (input) => {
            const r = await runTool(name, (input ?? {}) as Record<string, unknown>, ctx);
            return r.ok ? clip(r.text) : `ERROR: ${clip(r.text, 8000)}`;
          },
        });
  };
  for (const def of TOOLS) add(def.name, def.description, modelSchema(def));
  for (const w of WEB_TOOLS) add(w.name, w.description, w.schema);
  return set;
}
