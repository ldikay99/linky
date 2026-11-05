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
