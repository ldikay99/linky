import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config.js";
import { sniff, sniffAudio, safeName } from "../server/files/sniff.js";
import { parseDelimited } from "../server/files/files.js";
import { KeyRing } from "../server/security/crypto.js";
import { plausiblePat, validOrgUrl, mapDoctor } from "../server/linky/connectors.js";
import { planLocal } from "../server/chat/local.js";

describe("cifrado por persona", () => {
  const keys = new KeyRing(randomBytes(32));
  it("abre lo propio y rechaza otra persona, otro propósito u otro registro", () => {
    const sealed = keys.seal("u1", "data", "conv:1", "hola");
    expect(keys.open("u1", "data", "conv:1", sealed).toString()).toBe("hola");
    expect(() => keys.open("u2", "data", "conv:1", sealed)).toThrow();
    expect(() => keys.open("u1", "files", "conv:1", sealed)).toThrow();
    expect(() => keys.open("u1", "data", "conv:2", sealed)).toThrow();
  });
  it("un byte alterado no se acepta", () => {
    const sealed = keys.seal("u1", "data", "x", "dato");
    sealed[sealed.length - 1] ^= 1;
    expect(() => keys.open("u1", "data", "x", sealed)).toThrow();
  });
});

describe("tipo real de los adjuntos", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  it("acepta imágenes, PDF, texto y SVG por contenido", () => {
    expect(sniff(png, "foto.exe")?.mediaType).toBe("image/png");
    expect(sniff(Buffer.from("%PDF-1.7\n..."), "a.pdf")?.kind).toBe("pdf");
    expect(sniff(Buffer.from("a,b\n1,2\n"), "datos.csv")?.mediaType).toBe("text/csv");
    expect(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "x.svg")?.mediaType).toBe("image/svg+xml");
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect(sniff(heic, "IMG.HEIC")?.mediaType).toBe("image/heic");
  });
  it("rechaza videos, ejecutables y zips que no son Office", () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(16)]);
    expect(sniff(mp4, "video.mp4")).toBeNull();
    expect(sniff(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), "x.exe")).toBeNull();
    expect(sniff(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("otra/cosa.txt")]), "x.zip")).toBeNull();
    expect(sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), "x.msi")).toBeNull();
  });
  it("audio solo para dictado", () => {
    expect(sniffAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe("audio/webm");
    expect(sniffAudio(png)).toBeNull();
  });
  it("nombres sin rutas ni caracteres peligrosos", () => {
    expect(safeName("..\\..\\windows\\system32\\a.txt")).toBe("a.txt");
    expect(safeName('a<b>:"c|d?.png')).toBe("a_b___c_d_.png");
  });
  it("CSV con comillas y comas internas", () => {
    expect(parseDelimited('a,"b, c",d\n1,"dos ""2""",3\n', ",", "x").rows).toEqual([
      ["a", "b, c", "d"],
      ["1", 'dos "2"', "3"],
    ]);
  });
});

describe("configuración segura", () => {
  it("fuera de loopback exige https y en multi la clave maestra", () => {
    expect(() => loadConfig({ LINKY_WEB_HOST: "0.0.0.0" })).toThrow(/https/);
    expect(() => loadConfig({ LINKY_WEB_TENANCY: "multi" })).toThrow(/MASTER_KEY/);
    expect(loadConfig({}).host).toBe("127.0.0.1");
  });
  it("valida organización y token sin aceptar basura", () => {
    expect(validOrgUrl("https://dev.azure.com/MiOrg")).toBe(true);
    expect(validOrgUrl("https://evil.com/dev.azure.com/x")).toBe(false);
    expect(validOrgUrl("http://dev.azure.com/MiOrg")).toBe(false);
    expect(plausiblePat("x".repeat(52))).toBe(true);
    expect(plausiblePat("con espacios dentro del token largo")).toBe(false);
  });
});

describe("conectores desde doctor", () => {
  it("agrupa por área y marca lo opcional", () => {
    const r = mapDoctor([
      { area: "azure https://dev.azure.com/A (principal)", ok: true, detail: "pat: Persona" },
      { area: "google", ok: false, detail: "sin sesión", fix: "google login" },
      { area: "llavero", ok: false, detail: "no disponible" },
    ]);
    expect(r.connectors.find((c) => c.id === "azure")?.state).toBe("connected");
    expect(r.connectors.find((c) => c.id === "google")?.state).toBe("disconnected");
    expect(r.connectors.find((c) => c.id === "chat")?.state).toBe("optional");
    expect(r.problems[0]).toMatch(/llavero/);
  });
});

describe("modo sin IA", () => {
  it("entiende pedidos comunes sin inventar", () => {
    expect(planLocal("estado", "America/Bogota")).toMatchObject({ kind: "tool", name: "linky_doctor" });
    expect(planLocal("mi día del 2026-11-10", "America/Bogota")).toMatchObject({ kind: "tool", name: "linky_day", input: { date: "2026-11-10" } });
    expect(planLocal("¿qué me falta en ripor este mes?", "America/Bogota")).toMatchObject({ name: "ripor_month" });
    expect(planLocal("quiero conectar mi token", "America/Bogota")).toMatchObject({ kind: "text", action: "open-connectors" });
    expect(planLocal("cuéntame un chiste", "America/Bogota").kind).toBe("text");
  });
});
