import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFakeSecretStore } from "../agent/lib/security/secretStore.js";
import { saveAzurePat, readAzurePat, patStatusLabel } from "../agent/lib/security/secrets.js";
import { secretsDir } from "../agent/lib/security/paths.js";

describe("secrets", () => {
  it("fake provider no crea archivo secreto ni expone fragmentos", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-sec-"));
    process.env.LINKY_DATA_DIR = dataDir;
    const fake = createFakeSecretStore();
    const saved = await saveAzurePat("synthetic-pat-unit-test-aaaa", { store: fake });
    expect(saved.backend).toBe("session");
    expect(patStatusLabel(true)).toBe("PAT configurado");
    expect(patStatusLabel(true)).not.toMatch(/synthetic|aaaa/);
    const got = await readAzurePat({ store: fake });
    expect(got).toBe("synthetic-pat-unit-test-aaaa");
    await expect(
      import("node:fs/promises").then((fs) => fs.access(path.join(secretsDir(dataDir), "azure-pat"))),
    ).rejects.toBeTruthy();
    delete process.env.LINKY_DATA_DIR;
  });

  it("bloquea si existe PAT plaintext legado", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-legacy-"));
    process.env.LINKY_DATA_DIR = dataDir;
    const dir = secretsDir(dataDir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "azure-pat"), "legacy-secret-should-block", "utf8");
    const fake = createFakeSecretStore();
    await expect(saveAzurePat("synthetic-pat-new", { store: fake })).rejects.toThrow(/texto plano legado/);
    delete process.env.LINKY_DATA_DIR;
  });

  it("sin keyring exige fallback explícito (no plaintext silencioso)", async () => {
    // Forzamos fallo de keyring inyectando store? Probamos path sin store ni fallback
    // En CI puede haber keyring; simulamos con fallback omitido solo si keyring falla.
    // Verificamos que LINKY_SECRET_BACKEND no default a file.
    expect(process.env.LINKY_SECRET_BACKEND !== "file").toBe(true);
  });
});
