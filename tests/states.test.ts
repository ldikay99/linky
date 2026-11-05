import { describe, expect, it } from "vitest";
import { resolveTargetState } from "../agent/lib/azure/states.js";
import type { ProcessMeta } from "../agent/lib/types.js";

const meta: ProcessMeta = {
  workItemType: "Task",
  fields: [],
  states: [
    { name: "To Do" },
    { name: "In Progress" },
    { name: "Entregado" },
    { name: "Closed" },
  ],
  transitions: [],
};

describe("states", () => {
  it("separa entregado de cerrado", () => {
    expect(resolveTargetState(meta, "entregado").state).toBe("Entregado");
    expect(resolveTargetState(meta, "cerrado").state).toBe("Closed");
  });
});

describe("estados numerados (procesos personalizados)", () => {
  it("'3. Entregado' es entregado exacto y nunca elige '4. Cerrado'", async () => {
    const { resolveTargetState, stateBaseName } = await import("../agent/lib/azure/states.js");
    const meta = {
      workItemType: "Task",
      fields: [],
      transitions: [],
      states: ["1. En Planeacion", "2. En Curso", "3. Entregado", "4. Cerrado", "X. Removido"].map((name) => ({ name })),
    };
    expect(stateBaseName("3. Entregado")).toBe("entregado");
    expect(resolveTargetState(meta, "entregado")).toMatchObject({ state: "3. Entregado", needsConfirmation: false, isCloseLike: false });
    expect(resolveTargetState(meta, "en_curso").state).toBe("2. En Curso");
    expect(resolveTargetState(meta, "planeado").state).toBe("1. En Planeacion");
  });
});
