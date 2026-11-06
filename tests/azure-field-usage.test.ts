import { describe, expect, it } from "vitest";
import { commonlyFilledButMissing, fieldUsage } from "../agent/lib/azure/fieldUsage.js";
import type { ProcessMeta } from "../agent/lib/types.js";

const meta: ProcessMeta = {
  workItemType: "Task",
  states: [],
  transitions: [],
  fields: [
    { referenceName: "System.Title", name: "Title", type: "string", required: true, readOnly: false },
    { referenceName: "System.Description", name: "Description", type: "html", required: false, readOnly: false },
    { referenceName: "System.Tags", name: "Tags", type: "plainLists", required: false, readOnly: false },
    { referenceName: "Custom.Ticket", name: "Ticket", type: "string", required: false, readOnly: false },
    { referenceName: "Custom.Nunca", name: "Nunca", type: "string", required: false, readOnly: false },
    { referenceName: "System.ChangedDate", name: "Changed Date", type: "dateTime", required: false, readOnly: false },
    { referenceName: "System.Rev", name: "Rev", type: "integer", required: false, readOnly: true },
  ],
};

const refs = [
  { id: 1, rev: 1, fields: { "System.Title": "Uno", "System.Description": "<p>Se hizo <b>algo</b></p>", "System.Tags": "EQUIPO", "Custom.Ticket": "Evidencia: x", "System.ChangedDate": "x" } },
  { id: 2, rev: 1, fields: { "System.Title": "Dos", "System.Description": "<p>Otra cosa</p>", "System.Tags": "EQUIPO" } },
];

describe("campos que el equipo llena", () => {
  it("lista obligatorios y usados, sin automáticos ni de solo lectura", () => {
    const usage = fieldUsage(meta, refs);
    expect(usage.map((u) => u.referenceName)).toEqual(["System.Title", "System.Description", "System.Tags", "Custom.Ticket"]);
    expect(usage.find((u) => u.referenceName === "System.Description")?.example).toBe("Otra cosa");
    expect(usage.find((u) => u.referenceName === "Custom.Ticket")).toMatchObject({ filled: 1, of: 2 });
  });

  it("avisa lo que la mayoría llena y el cambio deja vacío", () => {
    const missing = commonlyFilledButMissing(fieldUsage(meta, refs), { "System.Title": "Nueva", "System.Description": "<p>ok</p>" });
    expect(missing.map((u) => u.referenceName)).toEqual(["System.Tags", "Custom.Ticket"]);
  });

  it("sin referencias solo quedan los obligatorios", () => {
    expect(fieldUsage(meta, []).map((u) => u.referenceName)).toEqual(["System.Title"]);
  });
});
