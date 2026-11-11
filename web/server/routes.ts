/**
 * Rutas de la API. Todas exigen sesión (ver auth.ts) y validan su entrada con zod.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { experimental_transcribe as transcribe } from "ai";
import type { Attachment, ConversationSummary, FileKind, SessionInfo } from "../shared/protocol.js";
import { NEW_TITLE, runTurn, type Deps } from "./chat/engine.js";
import { sniffAudio } from "./files/sniff.js";
import { plausiblePat, validOrgUrl, type Connectors } from "./linky/connectors.js";
import { cli } from "./linky/workspace.js";

const VERSION = "0.1.0";
const Id = z.string().uuid();
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Day = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/);

function bad(reply: FastifyReply, message: string, code = 400) {
  return reply.code(code).send({ error: message });
}

function parse<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null {
  const r = schema.safeParse(value);
  if (!r.success) {
    void bad(reply, r.error.issues.map((i) => `${i.path.join(".") || "datos"}: ${i.message}`).join("; "));
    return null;
  }
  return r.data;
}

const ChatBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    conversationId: Id.optional(),
    text: z.string().max(32_000),
    attachmentIds: z.array(Id).max(12).default([]),
  }),
  z.object({ kind: z.literal("approval"), conversationId: Id, approvalId: Id, approve: z.boolean() }),
]);

const ProfileBody = z.object({
  organizationUrl: z.string().refine(validOrgUrl, "URL de organización inválida"),
  project: z.string().min(1).max(200),
  occupation: z.string().min(2).max(300),
  projectContext: z.string().min(2).max(1200),
  assignedDisplayName: z.string().min(2).max(200),
  responsibleTag: z.string().max(120).optional(),
  mondayToThursday: z.object({ start: HHMM, end: HHMM }),
  friday: z.object({ start: HHMM, end: HHMM }),
  lunchStart: HHMM,
  lunchEnd: HHMM,
  huCreation: z.enum(["user_or_ai_with_approval", "scrum_or_third_party_only"]),
  taskClose: z.enum(["same_user", "scrum_or_third_party", "ask_each_time"]),
  huClose: z.enum(["same_user", "scrum_or_third_party", "ask_each_time"]),
});

export function registerRoutes(app: FastifyInstance, deps: Deps, connectors: Connectors) {
  const { store, files, workspaces, config, ai } = deps;
  const user = (req: FastifyRequest) => req.user!;
  const ws = (req: FastifyRequest) => workspaces.forUser(user(req));

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/session", async (req): Promise<SessionInfo> => {
    const u = user(req);
    return {
      user: { id: u.id, name: u.name, email: u.email, role: u.role },
      csrf: req.csrf!,
      ai: ai.status,
      stt: ai.transcriber ? "server" : "browser",
      onboarded: u.onboarded,
      tenancy: config.tenancy,
      maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
      interactiveLogin: config.interactiveLogin,
      version: VERSION,
    };
  });

  app.post("/api/onboarding/complete", async (req) => {
    store.updateUser(user(req).id, { onboarded: true });
    return { ok: true };
  });

  app.get("/api/welcome", async (req) => {
    const r = await cli(ws(req), ["welcome"], { timeoutMs: 30_000 });
    return { text: r.text };
  });

  // ---- conversaciones
  app.get("/api/conversations", async (req): Promise<ConversationSummary[]> => store.listConversations(user(req).id));

  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const id = parse(Id, req.params.id, reply);
    if (!id) return;
    const c = store.conversation(user(req).id, id);
    if (!c) return bad(reply, "Conversación no encontrada.", 404);
    return { id, title: c.title, updatedAt: c.updatedAt, messages: c.transcript };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/conversations/:id", async (req, reply) => {
    const id = parse(Id, req.params.id, reply);
    const body = parse(z.object({ title: z.string().trim().min(1).max(120) }), req.body, reply);
    if (!id || !body) return;
    store.renameConversation(user(req).id, id, body.title);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const id = parse(Id, req.params.id, reply);
    if (!id) return;
    store.deleteConversation(user(req).id, id);
    return { ok: true };
  });

  // ---- chat (SSE)
  app.post("/api/chat", { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(ChatBody, req.body, reply);
    if (!body) return;
    const u = user(req);
    let conversationId = body.conversationId;
    let attachments: Attachment[] = [];
    if (body.kind === "message") {
      if (!body.text.trim() && !body.attachmentIds.length) return bad(reply, "Escribe un mensaje o adjunta un archivo.");
      for (const fid of body.attachmentIds) {
        const f = store.file(u.id, fid);
        if (!f) return bad(reply, "Adjunto no encontrado.", 404);
        attachments.push({ id: f.id, name: f.name, mediaType: f.mediaType, kind: f.kind as FileKind, size: f.size });
      }
      if (!conversationId) conversationId = store.createConversation(u.id, NEW_TITLE);
      else if (!store.conversation(u.id, conversationId)) return bad(reply, "Conversación no encontrada.", 404);
    }
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) abort.abort();
    });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    const emit = (e: unknown) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const keepAlive = setInterval(() => !reply.raw.destroyed && reply.raw.write(": ping\n\n"), 15_000);
    try {
      if (body.kind === "message") {
        emit({ type: "conversation", id: conversationId, title: store.conversation(u.id, conversationId!)!.title });
        await runTurn(deps, u, conversationId!, { kind: "message", text: body.text, attachments }, emit, abort.signal);
      } else {
        await runTurn(deps, u, body.conversationId, { kind: "approval", approvalId: body.approvalId, approve: body.approve }, emit, abort.signal);
      }
    } catch (e) {
      emit({ type: "error", message: e instanceof Error ? e.message : "Error inesperado." });
      emit({ type: "done" });
    } finally {
      clearInterval(keepAlive);
      reply.raw.end();
    }
  });

  // ---- archivos
  app.post("/api/files", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const part = await req.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
    if (!part) return bad(reply, "No llegó ningún archivo.");
    const bytes = await part.toBuffer();
    if (part.file.truncated) return bad(reply, `El archivo supera ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`, 413);
    try {
      const row = await files.save(user(req).id, part.filename, bytes);
      return { id: row.id, name: row.name, mediaType: row.mediaType, kind: row.kind as FileKind, size: row.size } satisfies Attachment;
    } catch (e) {
      return bad(reply, (e as Error).message, (e as { statusCode?: number }).statusCode ?? 400);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>("/api/files/:id", async (req, reply) => {
    const id = parse(Id, req.params.id, reply);
    if (!id) return;
    const f = await files.read(user(req).id, id);
    if (!f) return bad(reply, "Archivo no encontrado.", 404);
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    return reply
      .header("Content-Type", f.row.mediaType)
      .header("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(f.row.name)}`)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      // Un adjunto nunca ejecuta nada (SVG con scripts, PDF con JS, etc.).
      .header("Content-Security-Policy", "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox")
      .header("Cross-Origin-Resource-Policy", "same-origin")
      .send(f.bytes);
  });

  app.get<{ Params: { id: string } }>("/api/files/:id/preview", async (req, reply) => {
    const id = parse(Id, req.params.id, reply);
    if (!id) return;
    const p = await files.preview(user(req).id, id).catch((e: Error) => ({ kind: "unsupported" as const, reason: `No se pudo leer el archivo: ${e.message}` }));
    if (!p) return bad(reply, "Archivo no encontrado.", 404);
    return p;
  });

  // ---- dictado
  app.post("/api/transcribe", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!ai.transcriber) return bad(reply, "El dictado del servidor no está configurado; se usa el del navegador.", 501);
    const part = await req.file({ limits: { fileSize: 12 * 1024 * 1024, files: 1 } });
    if (!part) return bad(reply, "No llegó audio.");
    const bytes = await part.toBuffer();
    if (part.file.truncated || !sniffAudio(bytes)) return bad(reply, "Audio no válido.", 415);
    const r = await transcribe({ model: ai.transcriber, audio: bytes, abortSignal: AbortSignal.timeout(60_000) });
    return { text: r.text.trim() };
  });

  // ---- conectores
  app.get<{ Querystring: { force?: string } }>("/api/connectors", async (req) => connectors.status(user(req), ws(req), req.query.force === "1"));

  app.post("/api/connectors/azure", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(
      z.object({
        organizationUrl: z.string().refine(validOrgUrl, "Usa https://dev.azure.com/<organización>"),
        pat: z.string().refine(plausiblePat, "El token no tiene un formato válido"),
        primary: z.boolean().default(false),
      }),
      req.body,
      reply,
    );
    if (!body) return;
    const r = await connectors.connectAzure(user(req), ws(req), body);
    store.audit(user(req).id, "connector.azure", r.ok ? "ok" : "error");
    if (!r.ok) return bad(reply, firstError(r.text), 422);
    const who = (r.json as { user?: string | { displayName?: string } } | null)?.user;
    const name = typeof who === "string" ? who : who?.displayName;
    if (name && config.tenancy === "single" && user(req).role === "owner") store.updateUser(user(req).id, { name });
    return { ok: true, user: name ?? null };
  });

  app.post<{ Params: { which: string } }>("/api/connectors/:which/login", async (req, reply) => {
    const which = parse(z.enum(["google", "ripor", "chat"]), req.params.which, reply);
    if (!which) return;
    if (!config.interactiveLogin) return bad(reply, "Este servidor no tiene pantalla para abrir el inicio de sesión. Google y Ripor se conectan por la integración directa de Google Cloud.", 409);
    const r = await connectors.login(user(req), ws(req), which);
    store.audit(user(req).id, `connector.${which}`, r.ok ? "ok" : "error");
    if (!r.ok) return bad(reply, firstError(r.text), 422);
    return { ok: true };
  });

  app.get("/api/connectors/dev/repos", async (req) => {
    const r = await connectors.devRepos(ws(req));
    return { ok: r.ok, data: r.json ?? r.text };
  });

  app.post("/api/connectors/dev/scan", async (req, reply) => {
    const body = parse(z.object({ root: z.string().min(1).max(500) }), req.body, reply);
    if (!body) return;
    const r = await connectors.devScan(user(req), ws(req), body.root);
    if (!r.ok) return bad(reply, firstError(r.text), 422);
    return { ok: true, data: r.json ?? r.text };
  });

  app.post("/api/connectors/dev/remove", async (req, reply) => {
    const body = parse(z.object({ repo: z.string().min(1).max(500) }), req.body, reply);
    if (!body) return;
    const r = await connectors.devRemove(user(req), ws(req), body.repo);
    if (!r.ok) return bad(reply, firstError(r.text), 422);
    return { ok: true };
  });

  // ---- onboarding
  app.get<{ Querystring: { date?: string } }>("/api/onboarding/meetings", async (req, reply) => {
    const date = req.query.date ? parse(Day, req.query.date, reply) : undefined;
    if (date === null) return;
    return connectors.meetings(user(req), ws(req), date);
  });

  app.post("/api/onboarding/meetings", async (req, reply) => {
    const body = parse(z.object({ title: z.string().min(1).max(300), action: z.enum(["confirm", "ignore"]) }), req.body, reply);
    if (!body) return;
    const r = await connectors.classifyMeeting(ws(req), body.title, body.action);
    if (!r.ok) return bad(reply, firstError(r.text), 422);
    return { ok: true };
  });

  app.post("/api/onboarding/profile", async (req, reply) => {
    const body = parse(ProfileBody, req.body, reply);
    if (!body) return;
    const r = await connectors.saveProfile(user(req), ws(req), body);
    store.audit(user(req).id, "onboarding.profile", r.ok ? "ok" : "error");
    if (!r.ok) return bad(reply, firstError(r.text), 422);
    return { ok: true };
  });
}

/** Primera línea útil de un error del CLI, sin rutas internas ni trazas. */
function firstError(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: string; errors?: string[] };
    if (j.error) return j.error;
    if (j.errors?.length) return j.errors.join("; ");
  } catch {
    /* texto plano */
  }
  const line = text.split("\n").find((l) => l.trim() && !/^\s+at /.test(l)) ?? "No se pudo completar.";
  return line.replace(/^Error:\s*/, "").slice(0, 400);
}
