import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createVaultSecretStore, openSecret, parseVaultKey, sealSecret } from "../agent/lib/security/vaultStore.js";

describe("bóveda cifrada de secretos", () => {
  it("guarda cifrado, lee y borra", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "linky-vault-"));
    const file = path.join(dir, "vault.json");
    const store = createVaultSecretStore(randomBytes(32), file);
    await store.set("linky-azure-devops", "pat", "synthetic-secret-value");
    expect(await readFile(file, "utf8")).not.toContain("synthetic-secret-value");
    expect(await store.get("linky-azure-devops", "pat")).toBe("synthetic-secret-value");
    await store.delete!("linky-azure-devops", "pat");
    expect(await store.get("linky-azure-devops", "pat")).toBeNull();
  });

  it("otra clave no puede leerla y un valor no sirve bajo otro nombre", () => {
    const key = randomBytes(32);
    const sealed = sealSecret(key, "a::b", "x");
    expect(() => openSecret(randomBytes(32), "a::b", sealed)).toThrow();
    expect(() => openSecret(key, "otro::nombre", sealed)).toThrow();
    expect(openSecret(key, "a::b", sealed)).toBe("x");
  });

  it("rechaza claves que no son de 32 bytes", () => {
    expect(parseVaultKey(undefined)).toBeNull();
    expect(() => parseVaultKey(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});
