/**
 * Un turno del chat: arma el historial (hidratando adjuntos), llama al modelo con las herramientas de Linky,
 * transmite texto y herramientas por SSE y, si el modelo pide una escritura, deja la aprobación pendiente.
 */
import { randomUUID } from "node:crypto";
import { stepCountIs, streamText, type ModelMessage, type UserContent } from "ai";
import type { ApprovalPart, Attachment, StreamEvent, ToolPart, UiMessage, UiPart } from "../../shared/protocol.js";
import { nativeFile, type Ai } from "../ai/providers.js";
import { systemPrompt } from "../ai/system.js";
import type { Config } from "../config.js";
import type { Files } from "../files/files.js";
import { APPROVALS, LABELS, approvalPreview, buildToolSet, runApproved, runTool, type ToolContext } from "../linky/tools.js";
import type { createWorkspaces } from "../linky/workspace.js";
import type { StoredHistory, Store, UserRow } from "../store/db.js";
import { planLocal, summarizeLocal, todayIn } from "./local.js";

export type Emit = (e: StreamEvent) => void;

export type Deps = { config: Config; ai: Ai; store: Store; files: Files; workspaces: ReturnType<typeof createWorkspaces> };

type StoredUserPart = { type: "text"; text: string } | { type: "attachment"; id: string; name: string; mediaType: string };

const TZ = process.env.LINKY_TZ || "America/Bogota";
export const NEW_TITLE = "Nueva conversación";
const HYDRATE_LAST_USER_TURNS = 4;

const busy = new Set<string>();

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…(recortado)` : s);

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
  const msgs = history.messages as Array<{ role: string; content: unknown }>;
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
  if (busy.has(lock)) throw Object.assign(new Error("Esta conversación ya está respondiendo."), { statusCode: 409 });
  busy.add(lock);
  try {
    const conv = deps.store.conversation(user.id, conversationId);
    if (!conv) throw Object.assign(new Error("Conversación no encontrada."), { statusCode: 404 });
    const { transcript, history } = conv;
    const ctx: ToolContext = { user, conversationId, ws: deps.workspaces.forUser(user), files: deps.files, history, signal };
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
      if (!signal.aborted) {
        const message = e instanceof Error ? e.message.split("\n")[0] : "Error inesperado.";
        pushPart({ type: "notice", tone: "error", text: `No se pudo completar la respuesta: ${message}` });
      }
    }
    if (!parts.length) transcript.pop();
    save();
    emit({ type: "done" });
  } finally {
    busy.delete(lock);
  }
}

type Sink = {
  pushText: (d: string) => void;
  pushPart: (p: ToolPart | ApprovalPart | Extract<UiPart, { type: "notice" }>) => void;
  patchTool: (id: string, patch: Partial<ToolPart>) => void;
};

async function modelTurn(deps: Deps, user: UserRow, ctx: ToolContext, history: StoredHistory, sink: Sink, signal: AbortSignal) {
  const started = new Map<string, number>();
  const result = streamText({
    model: deps.ai.model!,
    system: systemPrompt({ userName: user.name, today: todayIn(TZ), timeZone: TZ }),
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
    if (deps.ai.problem) sink.pushPart({ type: "notice", tone: "warn", text: deps.ai.problem });
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
  const summary = summarizeLocal(plan.name, json);
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
  if (!row || row.conversationId !== conversationId) throw Object.assign(new Error("Aprobación no encontrada."), { statusCode: 404 });
  if (!deps.store.settleApproval(user.id, row.id, input.approve ? "approved" : "rejected")) {
    throw Object.assign(new Error("Esta aprobación ya se resolvió."), { statusCode: 409 });
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
