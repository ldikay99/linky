/**
 * Reglas de validación compartidas: el servidor las aplica y la interfaz las usa antes de enviar.
 * Así lo que el frontend permite es exactamente lo que el backend acepta (y con el mismo mensaje).
 */
import { z } from "zod";
import { MSG } from "./messages.js";

export const LIMITS = {
  messageChars: 32_000,
  attachments: 12,
  titleChars: 120,
  uploadMbDefault: 25,
  audioMb: 12,
} as const;

/** Extensiones que la interfaz deja elegir; el servidor además valida el contenido real. */
export const ACCEPTED_EXT = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "tif", "tiff", "ico", "svg", "heic", "heif", "pdf", "doc", "docx", "xls", "xlsx", "csv", "tsv", "ppt", "pptx", "txt", "md", "json", "log", "xml", "yaml", "yml", "sql", "html"] as const;

export const ORG_URL_RE = /^https:\/\/(dev\.azure\.com\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}|[A-Za-z0-9][A-Za-z0-9-]{0,63}\.visualstudio\.com)\/?$/;
export const PAT_RE = /^[A-Za-z0-9._~+/=-]{20,400}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const id = z.uuid({ error: MSG.invalid });
const text = (max: number) => z.string({ error: MSG.required }).trim().min(1, { error: MSG.required }).max(max, { error: MSG.tooLong(max) });
const hhmm = z.string().regex(HHMM_RE, { error: MSG.hhmm });
const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
const span = z.object({ start: hhmm, end: hhmm }).refine((s) => toMin(s.end) > toMin(s.start), { error: MSG.range, path: ["end"] });

export const Schemas = {
  id,

  chat: z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("message"),
        conversationId: id.optional(),
        text: z.string().max(LIMITS.messageChars, { error: MSG.messageTooLong }),
        attachmentIds: z.array(id).max(LIMITS.attachments, { error: MSG.tooManyAttachments }).default([]),
      })
      .refine((b) => b.text.trim().length > 0 || b.attachmentIds.length > 0, { error: MSG.emptyMessage }),
    z.object({ kind: z.literal("approval"), conversationId: id, approvalId: id, approve: z.boolean() }),
  ]),

  rename: z.object({ title: z.string().trim().min(1, { error: MSG.titleEmpty }).max(LIMITS.titleChars, { error: MSG.titleTooLong }) }),

  azureConnect: z.object({
    organizationUrl: z.string().trim().regex(ORG_URL_RE, { error: MSG.orgUrl }),
    pat: z.string().trim().regex(PAT_RE, { error: MSG.pat }),
    primary: z.boolean().default(false),
  }),

  azureDisconnect: z.object({ organizationUrl: z.string().trim().regex(ORG_URL_RE, { error: MSG.orgUrl }) }),

  loginTarget: z.enum(["google", "ripor", "chat"], { error: MSG.notFound }),
  loginAction: z.enum(["login", "logout"], { error: MSG.notFound }),

  devScan: z.object({ root: z.string().trim().min(1, { error: MSG.repoRoot }).max(500, { error: MSG.tooLong(500) }) }),
  devRemove: z.object({ repo: text(500) }),

  meeting: z.object({ title: text(300), action: z.enum(["confirm", "ignore"]) }),

  day: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/, { error: MSG.invalid }),

  profile: z
    .object({
      organizationUrl: z.string().trim().regex(ORG_URL_RE, { error: MSG.orgUrl }),
      project: text(200),
      occupation: text(300),
      projectContext: text(1200),
      assignedDisplayName: text(200),
      responsibleTag: z.string().trim().max(120, { error: MSG.tooLong(120) }).optional(),
      mondayToThursday: span,
      friday: span,
      lunchStart: hhmm,
      lunchEnd: hhmm,
      huCreation: z.enum(["user_or_ai_with_approval", "scrum_or_third_party_only"]),
      taskClose: z.enum(["same_user", "scrum_or_third_party", "ask_each_time"]),
      huClose: z.enum(["same_user", "scrum_or_third_party", "ask_each_time"]),
    })
    .refine((p) => toMin(p.lunchEnd) > toMin(p.lunchStart), { error: MSG.range, path: ["lunchEnd"] }),
};

/** Primer error de una validación como { campo: mensaje } para mostrar junto a cada campo. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const key = i.path.join(".") || "_";
    if (!out[key]) out[key] = i.message;
  }
  return out;
}

export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? MSG.invalid;
}

export function extOf(name: string): string {
  return /\.([a-z0-9]{1,8})$/i.exec(name)?.[1].toLowerCase() ?? "";
}
