import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAzureStyle, saveItemStyle } from "../agent/lib/azure/style.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "linky-style-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("estilo de HU/Tasks aprobado", () => {
  it("vacío hasta que la persona aprueba uno", async () => {
    expect(await loadAzureStyle(dir)).toEqual({ version: 1 });
  });

  it("guarda y combina por tipo", async () => {
    await saveItemStyle("task", { title: "<Verbo> <objeto> - <frente>" }, dir);
    const s = await saveItemStyle("task", { example: "Consolidar novedades de nómina - Talento Humano" }, dir);
    expect(s.task?.title).toBe("<Verbo> <objeto> - <frente>");
    expect(s.task?.example).toContain("nómina");
    expect(s.hu).toBeUndefined();
  });

  it("rechaza fechas y estilos vacíos", async () => {
    await expect(saveItemStyle("hu", { example: "Informe del 4 de noviembre" }, dir)).rejects.toThrow(/fechas/);
    await expect(saveItemStyle("hu", {}, dir)).rejects.toThrow(/al menos/);
  });
});
