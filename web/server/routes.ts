/**
 * Rutas de la API. Todas exigen sesión (ver auth.ts) y validan su entrada con las mismas reglas que la interfaz
 * (shared/schemas.ts); los errores salen con los mensajes de shared/messages.ts.
 */
import { rm } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { experimental_transcribe as transcribe } from "ai";
import { MSG } from "../shared/messages.js";
import type { Attachment, ConversationSummary, FileKind, SessionInfo } from "../shared/protocol.js";
import { LIMITS, Schemas, firstError, memorySchema } from "../shared/schemas.js";
import { NEW_TITLE, runTurn, type Deps } from "./chat/engine.js";
import { sniffAudio } from "./files/sniff.js";
import type { Connectors } from "./linky/connectors.js";
import { cli } from "./linky/workspace.js";

const VERSION = "0.1.0";

export function bad(reply: FastifyReply, message: string, code = 400) {
  return reply.code(code).send({ error: message });
}

function parse<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null {
  const r = schema.safeParse(value);
  if (!r.success) {
    void bad(reply, firstError(r.error));
    return null;
  }
  return r.data;
}

export function registerRoutes(app: FastifyInstance, deps: Deps, connectors: Connectors) {
  const { store, files, workspaces, config, ai } = deps;
  const user = (req: FastifyRequest) => req.user!;
  const ws = (req: FastifyRequest) => workspaces.forUser(user(req));
  const maxMb = Math.round(config.maxUploadBytes / 1024 / 1024);

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
      maxUploadMb: maxMb,
      interactiveLogin: config.interactiveLogin,
      version: VERSION,
    };
  });

  app.post("/api/onboarding/complete", async (req) => {
    store.updateUser(user(req).id, { onboarded: true });
    return { ok: true };
  });

  // ---- datos de la persona
  app.delete("/api/me/data", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const u = user(req);
    const removed = store.deleteUserData(u.id);
    await files.removeAll(u.id);
    await rm(ws(req).scratchDir, { recursive: true, force: true });
    store.audit(u.id, "data.deleted", `${removed.conversations} conversaciones, ${removed.files} archivos`);
    return { ok: true, ...removed };
  });

  // ---- memoria (lo que Linky recuerda de la persona; visible y borrable por ella)
  app.get("/api/memory", async (req) => {
    const u = user(req);
    return {
      facts: store.memories(u.id, "fact", 500).map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt })),
      chunks: store.countMemories(u.id, "chunk"),
      semantic: deps.memory.semantic,
    };
  });

  app.post("/api/memory", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(memorySchema, req.body, reply);
    if (!body) return;
    const r = await deps.memory.remember(user(req).id, body.text);
    if (!r.ok) return bad(reply, r.reason === "secreto" ? MSG.memorySecret : MSG.memoryEmpty);
    return { ok: true, id: r.id, duplicate: Boolean(r.duplicate) };
  });

  app.delete<{ Params: { id: string } }>("/api/memory/:id", async (req, reply) => {
    const id = parse(Schemas.id, req.params.id, reply);
    if (!id) return;
    if (!store.deleteMemory(user(req).id, id)) return bad(reply, MSG.memoryNotFound, 404);
    return { ok: true };
  });

  app.delete("/api/memory", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const n = store.deleteMemories(user(req).id, "fact");
    store.audit(user(req).id, "memory.deleted", String(n));
    return { ok: true, deleted: n };
  });

  // ---- conversaciones
  app.get("/api/conversations", async (req): Promise<ConversationSummary[]> => store.listConversations(user(req).id));

  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const id = parse(Schemas.id, req.params.id, reply);
    if (!id) return;
    const c = store.conversation(user(req).id, id);
    if (!c) return bad(reply, MSG.conversationNotFound, 404);
    return { id, title: c.title, updatedAt: c.updatedAt, messages: c.transcript };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/conversations/:id", async (req, reply) => {
    const id = parse(Schemas.id, req.params.id, reply);
    if (!id) return;
    const body = parse(Schemas.rename, req.body, reply);
    if (!body) return;
    if (!store.renameConversation(user(req).id, id, body.title)) return bad(reply, MSG.conversationNotFound, 404);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const id = parse(Schemas.id, req.params.id, reply);
    if (!id) return;
    if (!store.deleteConversation(user(req).id, id)) return bad(reply, MSG.conversationNotFound, 404);
    return { ok: true };
  });

  // ---- chat (SSE)
  app.post("/api/chat", { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(Schemas.chat, req.body, reply);
    if (!body) return;
    const u = user(req);
    let conversationId = body.conversationId;
    const attachments: Attachment[] = [];
    if (body.kind === "message") {
      for (const fid of body.attachmentIds) {
        const f = store.file(u.id, fid);
        if (!f) return bad(reply, MSG.fileNotFound, 404);
        attachments.push({ id: f.id, name: f.name, mediaType: f.mediaType, kind: f.kind as FileKind, size: f.size });
      }
      if (conversationId && !store.conversation(u.id, conversationId)) return bad(reply, MSG.conversationNotFound, 404);
      if (!conversationId) conversationId = store.createConversation(u.id, NEW_TITLE);
    } else if (!store.conversation(u.id, body.conversationId)) {
      return bad(reply, MSG.conversationNotFound, 404);
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
      const known = (e as { expose?: boolean }).expose;
      if (!known) req.log.error(e);
      emit({ type: "error", message: known ? (e as Error).message : MSG.internal });
      emit({ type: "done" });
    } finally {
      clearInterval(keepAlive);
      reply.raw.end();
    }
  });

  // ---- archivos
  app.post("/api/files", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const t0 = Date.now();
    const part = await req.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } });
    if (!part) return bad(reply, MSG.fileMissing);
    const bytes = await part.toBuffer();
    if (part.file.truncated) return bad(reply, MSG.fileTooBig(maxMb), 413);
    try {
      const row = await files.save(user(req).id, part.filename, bytes);
      const ms = Date.now() - t0;
      // Diagnóstico sin datos de la persona: solo tamaño, tipo y tiempo.
      (ms > 5_000 ? req.log.warn : req.log.info).call(req.log, { upload: { bytes: bytes.length, type: row.mediaType, ms } }, "adjunto recibido");
      return { id: row.id, name: row.name, mediaType: row.mediaType, kind: row.kind as FileKind, size: row.size } satisfies Attachment;
    } catch (e) {
      return bad(reply, (e as Error).message, (e as { statusCode?: number }).statusCode ?? 400);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>("/api/files/:id", async (req, reply) => {
    const id = parse(Schemas.id, req.params.id, reply);
    if (!id) return;
    const f = await files.read(user(req).id, id);
    if (!f) return bad(reply, MSG.fileNotFound, 404);
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
    const id = parse(Schemas.id, req.params.id, reply);
    if (!id) return;
    const p = await files.preview(user(req).id, id).catch(() => ({ kind: "unsupported" as const, reason: MSG.filePreview }));
    if (!p) return bad(reply, MSG.fileNotFound, 404);
    return p;
  });

  // ---- dictado
  app.post("/api/transcribe", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!ai.transcriber) return bad(reply, MSG.sttOff, 501);
    const part = await req.file({ limits: { fileSize: LIMITS.audioMb * 1024 * 1024, files: 1 } });
    if (!part) return bad(reply, MSG.audioInvalid);
    const bytes = await part.toBuffer();
    if (part.file.truncated || !sniffAudio(bytes)) return bad(reply, MSG.audioInvalid, 415);
    const r = await transcribe({ model: ai.transcriber, audio: bytes, abortSignal: AbortSignal.timeout(60_000) });
    return { text: r.text.trim() };
  });

  // ---- conectores
  app.get<{ Querystring: { force?: string } }>("/api/connectors", async (req) => connectors.status(user(req), ws(req), req.query.force === "1"));

  app.get("/api/connectors/azure/orgs", async (req) => connectors.azureOrgs(ws(req)));

  app.post("/api/connectors/azure", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(Schemas.azureConnect, req.body, reply);
    if (!body) return;
    const r = await connectors.connectAzure(user(req), ws(req), body);
    store.audit(user(req).id, "connector.azure.connect", r.ok ? "ok" : "error");
    if (!r.ok) return bad(reply, cliError(r.text), 422);
    const who = (r.json as { user?: string | { displayName?: string } } | null)?.user;
    const name = typeof who === "string" ? who : who?.displayName;
    if (name && config.tenancy === "single" && user(req).role === "owner") store.updateUser(user(req).id, { name });
    return { ok: true, user: name ?? null };
  });

  app.post("/api/connectors/azure/disconnect", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = parse(Schemas.azureDisconnect, req.body, reply);
    if (!body) return;
    const r = await connectors.disconnectAzure(user(req), ws(req), body.organizationUrl);
    store.audit(user(req).id, "connector.azure.disconnect", r.ok ? "ok" : "error");
    if (!r.ok) return bad(reply, cliError(r.text), 422);
    return { ok: true };
  });

  app.post<{ Params: { which: string; action: string } }>("/api/connectors/:which/:action", async (req, reply) => {
    const which = parse(Schemas.loginTarget, req.params.which, reply);
    if (!which) return;
    const action = parse(Schemas.loginAction, req.params.action, reply);
    if (!action) return;
    if (action === "login" && !config.interactiveLogin) return bad(reply, MSG.noInteractiveLogin, 409);
    let r;
    if (action === "login") r = await connectors.login(user(req), ws(req), which);
    else if (which === "chat") return bad(reply, MSG.notFound, 404); // el CLI no tiene logout de chat
    else r = await connectors.logout(user(req), ws(req), which);
    store.audit(user(req).id, `connector.${which}.${action}`, r.ok ? "ok" : "error");
    if (!r.ok) return bad(reply, cliError(r.text), 422);
    return { ok: true };
  });

  app.get("/api/connectors/dev/repos", async (req) => {
    const r = await connectors.devRepos(ws(req));
    return { ok: r.ok, data: r.json ?? null };
  });

  app.post("/api/connectors/dev/scan", async (req, reply) => {
    const body = parse(Schemas.devScan, req.body, reply);
    if (!body) return;
    const r = await connectors.devScan(user(req), ws(req), body.root);
    if (!r.ok) return bad(reply, cliError(r.text), 422);
    return { ok: true, data: r.json ?? null };
  });

  app.post("/api/connectors/dev/remove", async (req, reply) => {
    const body = parse(Schemas.devRemove, req.body, reply);
    if (!body) return;
    const r = await connectors.devRemove(user(req), ws(req), body.repo);
    if (!r.ok) return bad(reply, cliError(r.text), 422);
    return { ok: true };
  });

  // ---- onboarding
  app.get<{ Querystring: { date?: string } }>("/api/onboarding/meetings", async (req, reply) => {
    const date = req.query.date ? parse(Schemas.day, req.query.date, reply) : undefined;
    if (date === null) return;
    return connectors.meetings(user(req), ws(req), date);
  });

  app.post("/api/onboarding/meetings", async (req, reply) => {
    const body = parse(Schemas.meeting, req.body, reply);
    if (!body) return;
    const r = await connectors.classifyMeeting(ws(req), body.title, body.action);
    if (!r.ok) return bad(reply, cliError(r.text), 422);
    return { ok: true };
  });

  app.post("/api/onboarding/profile", async (req, reply) => {
    const body = parse(Schemas.profile, req.body, reply);
    if (!body) return;
    const r = await connectors.saveProfile(user(req), ws(req), body);
    store.audit(user(req).id, "onboarding.profile", r.ok ? "ok" : "error");
    if (!r.ok) return bad(reply, cliError(r.text), 422);
    return { ok: true };
  });

  app.get("/api/welcome", async (req) => {
    const r = await cli(ws(req), ["welcome"], { timeoutMs: 30_000 });
    return { text: r.text };
  });
}

/** Mensaje corto y seguro a partir de un error del CLI: primera línea útil, sin rutas, trazas ni comandos. */
export function cliError(text: string): string {
  if (/Tiempo agotado/.test(text)) return MSG.timeout;
  let line = "";
  try {
    const j = JSON.parse(text) as { error?: string; errors?: string[] };
    line = j.error ?? j.errors?.[0] ?? "";
  } catch {
    line = text.split("\n").find((l) => l.trim() && !/^\s+at /.test(l)) ?? "";
  }
  line = line
    .replace(/^(Error|TypeError|RangeError):\s*/, "")
    .replace(/[A-Za-z]:\\[^\s"']+|\/(?:home|Users|tmp|app|data|var)\/[^\s"']+/g, "…") // rutas internas
    // Instrucciones del CLI ("ejecuta npm run linky -- …"): en la web se usan botones.
    .replace(/\s*[:;,(]?\s*(?:ejecuta|corre|usa|run)?\s*(?:primero\s*)?(?:npm run|linky --)[^.)]*[.)]?/gi, "")
    .trim();
  if (!line) return MSG.internal;
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
