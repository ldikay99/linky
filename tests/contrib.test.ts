import { describe, expect, it } from "vitest";
import { contribBranch, needsFork, prBody, slugify } from "../agent/lib/contrib/branch.js";

describe("flujo de contribución", () => {
  it("rama por persona y tema, ASCII y corta", () => {
    expect(slugify("Arreglo evidencia Ripor ¡ya!")).toBe("arreglo-evidencia-ripor-ya");
    expect(contribBranch("Persona-Demo", "Mejorar Calendar", "main")).toBe("contrib/persona-demo/mejorar-calendar");
    expect(contribBranch("persona-demo", "otro tema", "contrib/persona-demo/mejorar-calendar")).toBe("contrib/persona-demo/mejorar-calendar");
    expect(() => contribBranch("persona-demo", "", "main")).toThrow(/--topic/);
  });

  it("fork solo si no tiene escritura", () => {
    expect(needsFork("ADMIN")).toBe(false);
    expect(needsFork("write")).toBe(false);
    expect(needsFork("READ")).toBe(true);
    expect(needsFork(undefined)).toBe(true);
  });

  it("el cuerpo del PR refleja la validación y pide aprobación", () => {
    const body = prBody({ summary: "Arregla X", checks: [{ name: "Tests", ok: true }, { name: "Escáner", ok: false }], author: "persona-demo" });
    expect(body).toContain("- [x] Tests");
    expect(body).toContain("- [ ] Escáner");
    expect(body).toMatch(/aprobación del mantenedor/);
  });
});
