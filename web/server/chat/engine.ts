/**
 * Un turno del chat: arma el historial (hidratando adjuntos), llama al modelo con las herramientas de Linky,
 * transmite texto y herramientas por SSE y, si el modelo pide una escritura, deja la aprobación pendiente.
 */
import { randomUUID } from "node:crypto";
import { generateText, stepCountIs, streamText, type ModelMessage, type UserContent } from "ai";
import { MSG } from "../../shared/messages.js";
import type { ApprovalPart, Attachment, StreamEvent, ToolPart, UiMessage, UiPart } from "../../shared/protocol.js";
import { nativeFile, type Ai } from "../ai/providers.js";
import { systemPrompt } from "../ai/system.js";
import type { Config } from "../config.js";
import type { Files } from "../files/files.js";
import { APPROVALS, LABELS, approvalPreview, buildToolSet, runApproved, runTool, type ToolContext } from "../linky/tools.js";
import type { createWorkspaces } from "../linky/workspace.js";
import type { Memory } from "../memory/memory.js";
import type { StoredHistory, Store, UserRow } from "../store/db.js";
import { planLocal, summarizeLocal, todayIn } from "./local.js";

export type Emit = (e: StreamEvent) => void;

export type Deps = { config: Config; ai: Ai; store: Store; files: Files; workspaces: ReturnType<typeof createWorkspaces>; memory: Memory };

type StoredUserPart = { type: "text"; text: string } | { type: "attachment"; id: string; name: string; mediaType: string };

const TZ = process.env.LINKY_TZ || "America/Bogota";
export const NEW_TITLE = "Nueva conversación";
const HYDRATE_LAST_USER_TURNS = 4;

const busy = new Set<string>();

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(recortado)` : s);

/** Error del proveedor de IA en un mensaje corto y sin detalles internos (claves, URLs, cuerpos de respuesta). */
export function aiErrorMessage(e: unknown): string {
  const status = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  if (status === 401 || status === 403) return MSG.aiAuth;
  if (status === 429 || status === 529 || status === 503) return MSG.aiRate;
  if ((e as Error)?.name === "TimeoutError") return MSG.timeout;
  return MSG.aiFailed;
}

export function summaryLines(text?: string): string[] {
  if (!text) return ["No hay preview para mostrar."];
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const pick = j.mostrarAlUsuario ?? j.humanSummary ?? j.resumen ?? j.texto ?? j.text;
    if (Array.isArray(pick)) return pick.map(String);
    if (typeof pick === "string") return pick.split("\n");
    return JSON.stringify(j, null, 2).split("\n").slice(0, 60);
  } catch {
    return text.split("\n").slice(0, 60);
  }
}

/** Convierte el historial guardado en mensajes del modelo; solo los últimos turnos llevan los bytes de adjuntos. */
async function hydrate(history: StoredHistory, deps: Deps, user: UserRow): Promise<ModelMessage[]> {
  // Solo lo posterior al resumen: lo anterior viaja resumido en las instrucciones del sistema.
  const msgs = (history.messages as Array<{ role: string; content: unknown }>).slice(history.summarizedUpTo ?? 0);
  const userIdx = msgs.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  const recent = new Set(userIdx.slice(-HYDRATE_LAST_USER_TURNS));
  const out: ModelMessage[] = [];
  for (const [i, m] of msgs.entries()) {
    if (m.role !== "user" || !Array.isArray(m.content)) {
      out.push(m as ModelMessage);
      continue;
    }
    const parts: Exclude<UserContent, string> = [];
    for (const p of m.content as StoredUserPart[]) {
      if (p.type === "text") {
        parts.push({ type: "text", text: p.text });
        continue;
      }
      const ref = `[Adjunto id=${p.id} nombre="${p.name}" tipo=${p.mediaType}]`;
      if (!recent.has(i)) {
        parts.push({ type: "text", text: `${ref} (anterior; pide attachment_path si lo necesitas)` });
        continue;
      }
      if (nativeFile(deps.ai.status.provider, p.mediaType)) {
        const f = await deps.files.read(user.id, p.id);
        if (f) {
          parts.push({ type: "text", text: ref });
          parts.push({ type: "file", data: f.bytes, mediaType: p.mediaType, filename: p.name });
          continue;
        }
      }
      const text = await deps.files.textFor(user.id, p.id).catch(() => null);
      parts.push({ type: "text", text: text ? `${ref}\n<contenido>\n${text}\n</contenido>` : `${ref} (formato sin lectura directa)` });
    }
    out.push({ role: "user", content: parts });
  }
  return out;
}

export type TurnInput =
  | { kind: "message"; text: string; attachments: Attachment[] }
  | { kind: "approval"; approvalId: string; approve: boolean };

export async function runTurn(deps: Deps, user: UserRow, conversationId: string, input: TurnInput, emit: Emit, signal: AbortSignal): Promise<void> {
  const lock = `${user.id}:${conversationId}`;
  if (busy.has(lock)) throw Object.assign(new Error(MSG.busyConversation), { statusCode: 409, expose: true });
  busy.add(lock);
  try {
    const conv = deps.store.conversation(user.id, conversationId);
    if (!conv) throw Object.assign(new Error(MSG.conversationNotFound), { statusCode: 404, expose: true });
    const { transcript, history } = conv;
    const ctx: ToolContext = { user, conversationId, ws: deps.workspaces.forUser(user), files: deps.files, memory: deps.memory, history, signal };
    const save = () => deps.store.saveConversation(user.id, conversationId, { transcript, history });

    if (input.kind === "message") {
      const text = input.text.trim().slice(0, 32_000);
      transcript.push({ id: randomUUID(), role: "user", createdAt: Date.now(), text, attachments: input.attachments });
      history.messages.push({
        role: "user",
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...input.attachments.map((a) => ({ type: "attachment", id: a.id, name: a.name, mediaType: a.mediaType })),
        ],
      });
      if (conv.title === NEW_TITLE && text) {
        const title = text.replace(/\s+/g, " ").slice(0, 64);
        deps.store.renameConversation(user.id, conversationId, title);
        emit({ type: "conversation", id: conversationId, title });
      }
    } else {
      const settled = await settleApproval(deps, user, conversationId, input, ctx, transcript, emit);
      save();
      if (!settled.continueModel) {
        emit({ type: "done" });
        return;
      }
    }

    const assistant: UiMessage = { id: randomUUID(), role: "assistant", createdAt: Date.now(), parts: [] };
    transcript.push(assistant);
    emit({ type: "message", message: assistant });
    const parts = assistant.parts!;
    const pushText = (delta: string) => {
      const last = parts[parts.length - 1];
      if (last?.type === "text") last.text += delta;
      else parts.push({ type: "text", text: delta });
      emit({ type: "text", delta });
    };
    const pushPart = (part: ToolPart | ApprovalPart | Extract<UiPart, { type: "notice" }>) => {
      parts.push(part);
      emit({ type: "part", part });
    };
    const patchTool = (id: string, patch: Partial<ToolPart>) => {
      const p = parts.find((x) => x.type === "tool" && x.id === id) as ToolPart | undefined;
      if (p) Object.assign(p, patch);
      emit({ type: "part-update", id, patch });
    };

    try {
      if (deps.ai.model) await modelTurn(deps, user, ctx, history, { pushText, pushPart, patchTool }, signal);
      else await localTurn(deps, ctx, input, { pushText, pushPart, patchTool });
    } catch (e) {
      if (!signal.aborted) pushPart({ type: "notice", tone: "error", text: aiErrorMessage(e) });
    }
    if (!parts.length) transcript.pop();
    save();
    emit({ type: "done" });
    // Se indexa el turno en segundo plano para poder encontrarlo después (memoria entre chats).
    const said = parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
    const asked = input.kind === "message" ? input.text : "";
    // (sin modelo, las respuestas son ayudas fijas: no aportan a la memoria)
    if (deps.ai.model) void deps.memory.indexTurn(user.id, conversationId, asked, said).catch(() => undefined);
  } finally {
    busy.delete(lock);
  }
}

type Sink = {
  pushText: (d: string) => void;
  pushPart: (p: ToolPart | ApprovalPart | Extract<UiPart, { type: "notice" }>) => void;
  patchTool: (id: string, patch: Partial<ToolPart>) => void;
};

const msgSize = (m: unknown) => JSON.stringify(m).length;

/** Texto plano de mensajes del modelo (para resumir): roles, textos y herramientas usadas, sin bytes de adjuntos. */
function transcriptOf(messages: unknown[]): string {
  return (messages as Array<{ role: string; content: unknown }>)
    .map((m) => {
      const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : ((m.content ?? []) as Array<Record<string, unknown>>);
      const text = parts
        .map((p) => {
          if (p.type === "text") return String(p.text ?? "");
          if (p.type === "attachment") return `[adjunto ${String(p.name)} id=${String(p.id)}]`;
          if (p.type === "tool-call") return `[usó ${String(p.toolName)} ${clip(JSON.stringify(p.input ?? {}), 400)}]`;
          if (p.type === "tool-result") return `[resultado ${String(p.toolName)}: ${clip(JSON.stringify((p.output as { value?: unknown })?.value ?? p.output ?? ""), 1_500)}]`;
          return "";
        })
        .filter(Boolean)
        .join(" ");
      return `${m.role === "user" ? "Persona" : m.role === "assistant" ? "Linky" : "Herramienta"}: ${text}`;
    })
    .join("\n");
}

/**
 * Si lo que se enviaría al modelo supera el presupuesto, resume lo más antiguo (cortando siempre antes de un mensaje
 * de la persona, para no separar una herramienta de su resultado). El historial completo queda guardado.
 */
export async function compactHistory(deps: Deps, history: StoredHistory, signal?: AbortSignal): Promise<boolean> {
  const budget = deps.config.ai.contextChars;
  const msgs = history.messages as Array<{ role: string }>;
  const start = history.summarizedUpTo ?? 0;
  const total = msgs.slice(start).reduce((n, m) => n + msgSize(m), 0) + (history.summary?.length ?? 0);
  if (total <= budget) return false;
  let keep = msgs.length;
  let acc = 0;
  for (let i = msgs.length - 1; i > start; i--) {
    acc += msgSize(msgs[i]);
    if (acc > budget * 0.5) break;
    if (msgs[i].role === "user") keep = i;
  }
  if (keep >= msgs.length) {
    // Un solo turno ya es enorme: se conserva desde el último mensaje de la persona.
    keep = msgs.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i > start).pop() ?? msgs.length;
  }
  if (keep <= start) return false;
  const older = transcriptOf(msgs.slice(start, keep));
  let summary = history.summary ?? "";
  try {
    const r = await generateText({
      model: deps.ai.model!,
      system:
        "Resumes conversaciones de trabajo para que el asistente siga sin perder contexto. Español, viñetas breves. " +
        "Conserva: decisiones, datos concretos (IDs de Tasks y HU, fechas, horas, organizaciones, nombres), preferencias de la persona, " +
        "pendientes y lo que ya se registró. Nunca incluyas tokens ni contraseñas.",
      prompt: `Resumen anterior:\n${summary || "(ninguno)"}\n\nMensajes nuevos a incorporar:\n${clip(older, budget)}`,
      abortSignal: signal ?? AbortSignal.timeout(90_000),
      maxRetries: 1,
    });
    summary = r.text.trim().slice(0, 10_000);
  } catch {
    // Sin resumen nuevo igual se respeta el presupuesto: queda el resumen anterior y la búsqueda en memoria.
  }
  history.summary = summary;
  history.summarizedUpTo = keep;
  return true;
}

async function modelTurn(deps: Deps, user: UserRow, ctx: ToolContext, history: StoredHistory, sink: Sink, signal: AbortSignal) {
  const started = new Map<string, number>();
  if (await compactHistory(deps, history, signal)) {
    sink.pushPart({ type: "tool", id: randomUUID(), name: "context", label: "Resumí la parte anterior de esta conversación para seguir con todo el contexto", status: "done" });
  }
  const lastUser = [...(history.messages as Array<{ role: string; content: unknown }>)].reverse().find((m) => m.role === "user");
  const query = transcriptOf(lastUser ? [lastUser] : []).slice(0, 2_000);
  const facts = await deps.memory.contextFacts(user.id, query).catch(() => []);
  const result = streamText({
    model: deps.ai.model!,
    system: systemPrompt({ userName: user.name, today: todayIn(TZ), timeZone: TZ, facts, summary: history.summary }),
    messages: await hydrate(history, deps, user),
    tools: buildToolSet(ctx),
    stopWhen: stepCountIs(deps.config.ai.maxSteps),
    abortSignal: signal,
  });
  const approvalCalls: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }> = [];
  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        sink.pushText(part.text);
        break;
      case "tool-call":
        if (APPROVALS[part.toolName]) {
          approvalCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: (part.input ?? {}) as Record<string, unknown> });
        } else {
          started.set(part.toolCallId, Date.now());
          sink.pushPart({ type: "tool", id: part.toolCallId, name: part.toolName, label: LABELS[part.toolName] ?? part.toolName, status: "running" });
        }
        break;
      case "tool-result": {
        const out = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
        sink.patchTool(part.toolCallId, { status: out.startsWith("ERROR:") ? "error" : "done", output: clip(out, 20_000), ms: Date.now() - (started.get(part.toolCallId) ?? Date.now()) });
        break;
      }
      case "tool-error":
        sink.patchTool(part.toolCallId, { status: "error", output: String((part.error as Error)?.message ?? part.error), ms: Date.now() - (started.get(part.toolCallId) ?? Date.now()) });
        break;
      case "error":
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      default:
        break;
    }
  }
  history.messages.push(...((await result.responseMessages) as unknown[]));
  for (const call of approvalCalls) {
    const id = randomUUID();
    deps.store.addApproval({ id, userId: user.id, conversationId: ctx.conversationId, toolCallId: call.toolCallId, toolName: call.toolName, input: call.input });
    sink.pushPart({ type: "approval", id, toolName: call.toolName, title: APPROVALS[call.toolName].title, summary: summaryLines(approvalPreview(call.toolName, history)), status: "pending" });
  }
}

async function localTurn(deps: Deps, ctx: ToolContext, input: TurnInput, sink: Sink) {
  if (input.kind !== "message") return;
  const plan = planLocal(input.text, TZ);
  if (plan.kind === "text") {
    sink.pushText(plan.text);
    if (plan.action) sink.pushPart({ type: "notice", tone: "info", text: plan.action === "open-connectors" ? "Abrir Conectores" : "Abrir configuración inicial", action: plan.action });
    return;
  }
  sink.pushText(`${plan.intro}\n\n`);
  const id = randomUUID();
  const t0 = Date.now();
  sink.pushPart({ type: "tool", id, name: plan.name, label: LABELS[plan.name] ?? plan.name, status: "running" });
  const r = await runTool(plan.name, plan.input, ctx);
  let json: unknown = null;
  try {
    json = JSON.parse(r.text);
  } catch {
    json = null;
  }
  // doctor y otros comandos salen con código 1 cuando hay algo por revisar, pero su JSON es válido.
  const summary = summarizeLocal(plan.name, json, r.text);
  sink.patchTool(id, { status: r.ok || summary ? "done" : "error", output: clip(r.text, 20_000), ms: Date.now() - t0 });
  sink.pushText(summary ?? (r.ok ? "Listo. El detalle completo está en la tarjeta de arriba." : "No se pudo completar. Revisa el detalle o abre Conectores."));
  if (!r.ok && summary) sink.pushPart({ type: "notice", tone: "info", text: "Abrir Conectores", action: "open-connectors" });
}

async function settleApproval(
  deps: Deps,
  user: UserRow,
  conversationId: string,
  input: Extract<TurnInput, { kind: "approval" }>,
  ctx: ToolContext,
  transcript: UiMessage[],
  emit: Emit,
): Promise<{ continueModel: boolean }> {
  const row = deps.store.approval(user.id, input.approvalId);
  if (!row || row.conversationId !== conversationId) throw Object.assign(new Error(MSG.approvalNotFound), { statusCode: 404, expose: true });
  if (!deps.store.settleApproval(user.id, row.id, input.approve ? "approved" : "rejected")) {
    throw Object.assign(new Error(MSG.approvalDone), { statusCode: 409, expose: true });
  }
  deps.store.audit(user.id, input.approve ? "approval.approved" : "approval.rejected", row.toolName);
  const part = transcript.flatMap((m) => m.parts ?? []).find((p) => p.type === "approval" && p.id === row.id) as ApprovalPart | undefined;
  let output: { type: "text"; value: string } | { type: "execution-denied"; reason: string };
  if (input.approve) {
    const r = await runApproved(row.toolName, row.input, ctx);
    const status = r.ok ? "approved" : "failed";
    if (part) Object.assign(part, { status, result: clip(r.text, 20_000) });
    emit({ type: "part-update", id: row.id, patch: { status, result: clip(r.text, 20_000) } });
    output = { type: "text", value: r.ok ? clip(r.text, 60_000) : `ERROR: ${clip(r.text, 8000)}` };
  } else {
    if (part) part.status = "rejected";
    emit({ type: "part-update", id: row.id, patch: { status: "rejected" } });
    output = { type: "execution-denied", reason: "La persona rechazó esta escritura." };
  }
  ctx.history.messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: row.toolCallId, toolName: row.toolName, output }] });
  // Si el modelo pidió varias escrituras a la vez, se continúa cuando todas estén resueltas.
  return { continueModel: Boolean(deps.ai.model) && deps.store.pendingApprovals(user.id, conversationId).length === 0 };
}
