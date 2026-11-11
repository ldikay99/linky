import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MSG } from "../shared/messages.js";
import { LIMITS, Schemas, fieldErrors } from "../shared/schemas.js";
import { aiErrorMessage } from "../server/chat/engine.js";
import { createFiles } from "../server/files/files.js";
import { cliError } from "../server/routes.js";
import { KeyRing } from "../server/security/crypto.js";
import { openStore } from "../server/store/db.js";

describe("reglas compartidas (misma validación en interfaz y servidor)", () => {
  it("mensaje vacío, demasiado largo o con demasiados adjuntos", () => {
    const empty = Schemas.chat.safeParse({ kind: "message", text: "   ", attachmentIds: [] });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0].message).toBe(MSG.emptyMessage);
    const long = Schemas.chat.safeParse({ kind: "message", text: "x".repeat(LIMITS.messageChars + 1) });
    expect(long.error?.issues[0].message).toBe(MSG.messageTooLong);
    const ids = Array.from({ length: LIMITS.attachments + 1 }, () => crypto.randomUUID());
    expect(Schemas.chat.safeParse({ kind: "message", text: "hola", attachmentIds: ids }).error?.issues[0].message).toBe(MSG.tooManyAttachments);
  });
  it("conector de Azure con mensajes por campo", () => {
    const r = Schemas.azureConnect.safeParse({ organizationUrl: "http://otra.com", pat: "corto" });
    expect(fieldErrors(r.error!)).toEqual({ organizationUrl: MSG.orgUrl, pat: MSG.pat });
  });
  it("horario: la salida va después de la entrada", () => {
    const base = {
      organizationUrl: "https://dev.azure.com/Org",
      project: "P",
      occupation: "Analista",
      projectContext: "Contexto",
      assignedDisplayName: "Persona",
      mondayToThursday: { start: "18:00", end: "08:30" },
      friday: { start: "08:00", end: "17:00" },
      lunchStart: "12:00",
      lunchEnd: "13:00",
      huCreation: "scrum_or_third_party_only",
      taskClose: "scrum_or_third_party",
      huClose: "scrum_or_third_party",
    };
    expect(fieldErrors(Schemas.profile.safeParse(base).error!)["mondayToThursday.end"]).toBe(MSG.range);
    expect(Schemas.profile.safeParse({ ...base, mondayToThursday: { start: "08:30", end: "18:00" } }).success).toBe(true);
  });
  it("título de conversación", () => {
    expect(Schemas.rename.safeParse({ title: "  " }).error?.issues[0].message).toBe(MSG.titleEmpty);
    expect(Schemas.rename.safeParse({ title: "x".repeat(121) }).error?.issues[0].message).toBe(MSG.titleTooLong);
  });
});

describe("mensajes de error seguros", () => {
  it("los errores del CLI salen cortos, sin rutas internas ni comandos", () => {
    expect(cliError("Error: No existe C:\\Users\\Persona\\.linky\\profile.json")).not.toMatch(/Users|profile\.json/);
    expect(cliError('{"error":"Falta PAT: ejecuta primero npm run linky -- azure connect --org <url>."}')).toBe("Falta PAT");
    expect(cliError("Tiempo agotado; el proceso se cerró")).toBe(MSG.timeout);
    expect(cliError("")).toBe(MSG.internal);
    expect(cliError("x".repeat(500)).length).toBeLessThanOrEqual(160);
  });
  it("errores del proveedor de IA sin detalles", () => {
    expect(aiErrorMessage({ statusCode: 401, message: "Invalid API key sk-..." })).toBe(MSG.aiAuth);
    expect(aiErrorMessage({ statusCode: 429 })).toBe(MSG.aiRate);
    expect(aiErrorMessage(new Error("socket hang up at https://api..."))).toBe(MSG.aiFailed);
  });
});

describe("borrar los datos de una persona", () => {
  it("borra conversaciones y adjuntos cifrados solo de esa persona", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "linky-del-"));
    const keys = new KeyRing(randomBytes(32));
    const store = openStore(dir, keys);
    const files = createFiles(dir, keys, store);
    const a = store.createUser("A", null, "member");
    const b = store.createUser("B", null, "member");
    store.createConversation(a.id, "uno");
    store.createConversation(a.id, "dos");
    store.createConversation(b.id, "de B");
    const f = await files.save(a.id, "nota.txt", Buffer.from("hola"));
    expect(store.deleteUserData(a.id)).toEqual({ conversations: 2, files: 1 });
    await files.removeAll(a.id);
    expect(store.listConversations(a.id)).toEqual([]);
    expect(await files.read(a.id, f.id)).toBeNull();
    expect(store.listConversations(b.id).map((c) => c.title)).toEqual(["de B"]);
    expect(store.renameConversation(a.id, crypto.randomUUID(), "x")).toBe(false);
  });
});
