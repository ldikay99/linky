import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { TOOLS, jsonSchema } from "../agent/lib/mcp/tools.js";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe("herramientas MCP", () => {
  it("nombres únicos y esquemas JSON válidos", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      const s = jsonSchema(t);
      expect(s.type).toBe("object");
      for (const r of s.required) expect(Object.keys(t.properties)).toContain(r);
    }
  });

  it("traduce parámetros a argumentos del CLI", () => {
    expect(tool("ripor_preview").toArgs({ date: "2026-11-04", auto: true, evidence: ["https://a", "https://b"], under_hours: "cita médica", hours: 4 })).toEqual([
      "ripor", "preview", "--date", "2026-11-04", "--auto", "--evidence", "https://a", "--evidence", "https://b", "--hours", "4", "--under-hours", "cita médica",
    ]);
    expect(tool("mail_day").toArgs({ box: "received" })).toEqual(["mail", "day", "--received"]);
    expect(tool("chat_draft").toArgs({ kind: "cierre", date: "2026-11-04" })).toEqual(["chat", "draft", "--cierre", "--date", "2026-11-04"]);
    expect(tool("azure_delete").toArgs({ id: "5" })).toEqual(["azure", "delete", "--id", "5"]);
  });

  it("las escrituras exigen approved=true y snapshot", () => {
    expect(() => tool("ripor_apply").toArgs({ snapshot: "h", approved_by: "x", approved: false })).toThrow(/sin aprobación/);
    expect(() => tool("chat_send").toArgs({ approved: true })).toThrow(/snapshot/);
    expect(tool("azure_hours_apply").toArgs({ snapshot: "h", approved: true })).toEqual(["azure", "hours", "--apply", "--approve", "--snapshot", "h"]);
    expect(tool("ripor_apply").toArgs({ snapshot: "h", approved_by: "persona", approved: true })).toEqual(["ripor", "apply", "--approve", "--snapshot", "h", "--by", "persona"]);
  });
});

describe("servidor MCP (stdio)", () => {
  it("initialize, tools/list y método desconocido; se cierra con el cliente", async () => {
    const root = path.resolve(__dirname, "..");
    const srv = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "agent/lib/mcp/server.ts")], { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
    const rl = createInterface({ input: srv.stdout! });
    const waiting = new Map<number, (m: any) => void>();
    rl.on("line", (l) => {
      const m = JSON.parse(l);
      waiting.get(m.id)?.(m);
    });
    const call = (id: number, method: string, params?: unknown) =>
      new Promise<any>((res) => {
        waiting.set(id, res);
        srv.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    const init = await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result.serverInfo.name).toBe("linky");
    expect(init.result.capabilities.tools).toBeDefined();
    const list = await call(2, "tools/list");
    expect(list.result.tools.length).toBe(TOOLS.length);
    expect(list.result.tools[0].inputSchema.type).toBe("object");
    const bad = await call(3, "metodo/raro");
    expect(bad.error.code).toBe(-32601);
    srv.stdin!.end();
    const code = await new Promise((r) => srv.on("close", r));
    expect(code).toBe(0);
  }, 60_000);
});
