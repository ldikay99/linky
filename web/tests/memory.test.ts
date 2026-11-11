import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { looksSecret } from "../shared/schemas.js";
import type { Ai } from "../server/ai/providers.js";
import { compactHistory, type Deps } from "../server/chat/engine.js";
import { loadConfig } from "../server/config.js";
import { createFiles } from "../server/files/files.js";
import { createWorkspaces } from "../server/linky/workspace.js";
import { bm25, createMemory } from "../server/memory/memory.js";
import { KeyRing } from "../server/security/crypto.js";
import { openStore, type StoredHistory } from "../server/store/db.js";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "linky-mem-"));
  const keys = new KeyRing(randomBytes(32));
  const store = openStore(dir, keys);
  const user = store.createUser("Persona", null, "member");
  return { dir, keys, store, user, memory: createMemory(store, null) };
}

describe("memoria de la persona", () => {
  it("búsqueda por palabras ignora tildes y mayúsculas", () => {
    const s = bm25("tareas de PQRD con Davis", ["Las Tasks de PQRD llevan la etiqueta DAVIS DIAZ", "Ripor se llena a las 18:00", "Reunión diaria"]);
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[0]).toBeGreaterThan(s[2]);
  });

  it("guarda recuerdos, no duplica y nunca guarda secretos", async () => {
    const { store, user, memory } = await setup();
    expect((await memory.remember(user.id, "Las Tasks de IA llevan DAVIS DIAZ y 005-SGDEA")).ok).toBe(true);
    expect((await memory.remember(user.id, "las tasks de ia llevan davis diaz y 005-sgdea")).duplicate).toBe(true);
    expect((await memory.remember(user.id, "mi token es abcd1234efgh5678ijkl9012mnop3456qrst")).reason).toBe("secreto");
    expect((await memory.remember(user.id, "contraseña: Sup3rSecreta")).reason).toBe("secreto");
    expect(store.memories(user.id, "fact").map((m) => m.text)).toEqual(["Las Tasks de IA llevan DAVIS DIAZ y 005-SGDEA"]);
  });

  it("las URL y los IDs normales no se confunden con secretos", () => {
    expect(looksSecret("La HU es https://dev.azure.com/Linktic/242%20-%20INGENIERIA%20DE%20DATOS/_workitems/edit/560365")).toBe(false);
    expect(looksSecret("Commit 9c22c26d21f11961046dabe6235cf2ae80acf127")).toBe(true); // hash largo: mejor no guardarlo como recuerdo
    expect(looksSecret("Usa la etiqueta 005-SGDEA en las Tasks de PQRD")).toBe(false);
  });

  it("indexa turnos para buscarlos después y se borran con su conversación", async () => {
    const { store, user, memory } = await setup();
    const conv = store.createConversation(user.id, "PQRD");
    await memory.indexTurn(user.id, conv, "registra lo de observaciones de PQRD", "Creé la Task 565722 con 4 horas bajo la HU 560365.");
    const hits = await memory.search(user.id, "observaciones PQRD");
    expect(hits[0].text).toMatch(/565722/);
    store.deleteConversation(user.id, conv);
    expect(store.countMemories(user.id, "chunk")).toBe(0);
  });

  it("el contenido de la memoria va cifrado en la base", async () => {
    const { dir, store, user, memory } = await setup();
    await memory.remember(user.id, "Prefiere descripciones cortas");
    store.close();
    const { readFile } = await import("node:fs/promises");
    expect((await readFile(path.join(dir, "linky-web.db"))).includes(Buffer.from("Prefiere descripciones cortas"))).toBe(false);
  });
});

describe("contexto largo", () => {
  it("resume lo antiguo sin cortar entre una herramienta y su resultado, y guarda el historial completo", async () => {
    const { dir, keys, store, memory } = await setup();
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        ({
          content: [{ type: "text", text: "- Se registraron Tasks de PQRD." }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          warnings: [],
        }) as never,
    });
    const config = loadConfig({ LINKY_WEB_DATA_DIR: dir, LINKY_AI_CONTEXT_CHARS: "20000" });
    const ai: Ai = { status: { configured: true, provider: "anthropic", model: "mock" }, model, transcriber: null, embedder: null, problem: null };
    const deps: Deps = { config, ai, store, files: createFiles(dir, keys, store), workspaces: createWorkspaces(config, keys), memory };
    const big = "x".repeat(3_000);
    const messages: unknown[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push({ role: "user", content: [{ type: "text", text: `pedido ${i} ${big}` }] });
      messages.push({ role: "assistant", content: [{ type: "tool-call", toolCallId: `t${i}`, toolName: "linky_day", input: {} }] });
      messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: `t${i}`, toolName: "linky_day", output: { type: "text", value: big } }] });
    }
    const history: StoredHistory = { messages, previews: {} };
    expect(await compactHistory(deps, history)).toBe(true);
    expect(history.summary).toBe("- Se registraron Tasks de PQRD.");
    const cut = history.summarizedUpTo!;
    expect((messages[cut] as { role: string }).role).toBe("user"); // nunca separa herramienta y resultado
    expect(history.messages.length).toBe(36); // el historial completo se conserva
    const sent = messages.slice(cut).reduce((n: number, m) => n + JSON.stringify(m).length, 0);
    expect(sent).toBeLessThanOrEqual(20_000);
    expect(await compactHistory(deps, history)).toBe(false); // ya cabe
  });
});
