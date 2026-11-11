import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../shared/protocol.js";
import type { Ai } from "../server/ai/providers.js";
import { loadConfig } from "../server/config.js";
import { runTurn, type Deps } from "../server/chat/engine.js";
import { createFiles } from "../server/files/files.js";
import { createWorkspaces } from "../server/linky/workspace.js";
import { KeyRing } from "../server/security/crypto.js";
import { openStore } from "../server/store/db.js";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

function streamOf(parts: unknown[]) {
  return {
    stream: new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(p);
        c.close();
      },
    }),
  };
}

const text = (id: string, t: string) => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: t },
  { type: "text-end", id },
];
const finish = (reason: "stop" | "tool-calls") => ({ type: "finish", finishReason: { unified: reason, raw: reason }, usage });

async function setup(responses: unknown[][]) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "linky-web-"));
  const config = loadConfig({ LINKY_WEB_DATA_DIR: dataDir, LINKY_WEB_TENANCY: "single" });
  const keys = new KeyRing(randomBytes(32));
  const store = openStore(dataDir, keys);
  const files = createFiles(dataDir, keys, store);
  let call = 0;
  const model = new MockLanguageModelV4({ doStream: async () => streamOf(responses[Math.min(call++, responses.length - 1)]) as never });
  const ai: Ai = { status: { configured: true, provider: "anthropic", model: "mock" }, model, transcriber: null, problem: null };
  // Persona que no es dueña: su Linky queda aislado en el directorio de la prueba (nunca toca ~/.linky).
  const user = store.createUser("Persona Prueba", null, "member");
  const deps: Deps = { config, ai, store, files, workspaces: createWorkspaces(config, keys) };
  return { deps, store, files, user, model };
}

async function turn(deps: Deps, user: Parameters<typeof runTurn>[1], conv: string, input: Parameters<typeof runTurn>[3]) {
  const events: StreamEvent[] = [];
  await runTurn(deps, user, conv, input, (e) => events.push(e), new AbortController().signal);
  return events;
}

describe("motor del chat", () => {
  it("transmite texto, ejecuta herramientas y guarda todo cifrado", async () => {
    const { deps, store, files, user } = await setup([
      [...text("a", "Preparo tu evidencia. "), { type: "tool-call", toolCallId: "t1", toolName: "attachment_path", input: "{}" }, finish("tool-calls")],
      [...text("b", "Listo."), finish("stop")],
    ]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const f = await files.save(user.id, "foto.png", png);
    const conv = store.createConversation(user.id, "Nueva conversación");
    const events = await turn(deps, user, conv, { kind: "message", text: "usa esta foto", attachments: [{ id: f.id, name: f.name, mediaType: f.mediaType, kind: "image", size: f.size }] });
    const textOut = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(textOut).toBe("Preparo tu evidencia. Listo.");
    expect(events.some((e) => e.type === "part" && e.part.type === "tool" && e.part.name === "attachment_path")).toBe(true);
    expect(events.some((e) => e.type === "part-update" && (e.patch as { status?: string }).status === "error")).toBe(true); // sin id: error controlado
    expect(events.at(-1)).toEqual({ type: "done" });
    const saved = store.conversation(user.id, conv)!;
    expect(saved.title).toBe("usa esta foto");
    expect(saved.transcript.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("una escritura queda pendiente; rechazarla avisa al modelo y no se aplica dos veces", async () => {
    const { deps, store, user, model } = await setup([
      [...text("a", "Te muestro el cambio."), { type: "tool-call", toolCallId: "w1", toolName: "azure_day_apply", input: JSON.stringify({ snapshot: "abc" }) }, finish("tool-calls")],
      [...text("b", "Entendido, no lo aplico."), finish("stop")],
    ]);
    const conv = store.createConversation(user.id, "Nueva conversación");
    // Preview que la persona ya vio (lo deja azure_day_preview).
    const c = store.conversation(user.id, conv)!;
    store.saveConversation(user.id, conv, { transcript: c.transcript, history: { ...c.history, previews: { azure_day_preview: JSON.stringify({ snapshotHash: "abc", humanSummary: ["Crear Task: Ejemplo"] }) } } });

    const first = await turn(deps, user, conv, { kind: "message", text: "regístralo", attachments: [] });
    const approval = first.find((e) => e.type === "part" && e.part.type === "approval") as Extract<StreamEvent, { type: "part" }> | undefined;
    expect(approval?.part.type).toBe("approval");
    const part = approval!.part as { id: string; summary: string[]; status: string };
    expect(part.summary).toEqual(["Crear Task: Ejemplo"]);
    expect(part.status).toBe("pending");
    expect(model.doStreamCalls.length).toBe(1); // el modelo se detuvo esperando a la persona
    // El modelo nunca recibe "approved" en el esquema de la herramienta.
    const tools = (model.doStreamCalls[0] as { tools?: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> }).tools ?? [];
    expect(Object.keys(tools.find((t) => t.name === "ripor_apply")!.inputSchema.properties ?? {})).not.toContain("approved");

    const second = await turn(deps, user, conv, { kind: "approval", approvalId: part.id, approve: false });
    expect(second.some((e) => e.type === "part-update" && (e.patch as { status?: string }).status === "rejected")).toBe(true);
    expect(second.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("Entendido, no lo aplico.");
    const lastPrompt = JSON.stringify(model.doStreamCalls[1].prompt);
    expect(lastPrompt).toContain("execution-denied");

    await expect(turn(deps, user, conv, { kind: "approval", approvalId: part.id, approve: true })).rejects.toThrow(/ya se resolvió/);
  });

  it("si el snapshot no coincide con el preview mostrado, no se aplica", async () => {
    const { deps, store, user } = await setup([
      [{ type: "tool-call", toolCallId: "w1", toolName: "azure_day_apply", input: JSON.stringify({ snapshot: "otro" }) }, finish("tool-calls")],
      [...text("b", "No se aplicó."), finish("stop")],
    ]);
    const conv = store.createConversation(user.id, "Nueva conversación");
    const c = store.conversation(user.id, conv)!;
    store.saveConversation(user.id, conv, { transcript: c.transcript, history: { ...c.history, previews: { azure_day_preview: JSON.stringify({ snapshotHash: "abc" }) }, dayPreviewFile: "x.json" } });
    const first = await turn(deps, user, conv, { kind: "message", text: "aplica", attachments: [] });
    const id = (first.find((e) => e.type === "part" && e.part.type === "approval") as Extract<StreamEvent, { type: "part" }>).part.id;
    const second = await turn(deps, user, conv, { kind: "approval", approvalId: id, approve: true });
    const upd = second.find((e) => e.type === "part-update") as Extract<StreamEvent, { type: "part-update" }>;
    expect(upd.patch).toMatchObject({ status: "failed" });
    expect(String((upd.patch as { result?: string }).result)).toMatch(/snapshot no coincide/);
  });
});
