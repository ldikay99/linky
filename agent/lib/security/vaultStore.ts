/**
 * Bóveda cifrada en archivo para servidores sin llavero del sistema (contenedores, multiusuario).
 * Cada valor va con AES-256-GCM y la clave del registro como AAD (no se pueden intercambiar valores).
 * La clave llega solo por entorno (LINKY_VAULT_KEY, 32 bytes en base64) y nunca se escribe a disco.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SecretStore } from "./secretStore.js";

const VERSION = "v1";

export function parseVaultKey(raw: string | undefined): Buffer | null {
  if (!raw?.trim()) return null;
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) throw new Error("LINKY_VAULT_KEY debe ser de 32 bytes en base64.");
  return key;
}

export function sealSecret(key: Buffer, name: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(name, "utf8"));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${VERSION}.${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
}

export function openSecret(key: Buffer, name: string, sealed: string): string {
  const [v, b64] = sealed.split(".", 2);
  if (v !== VERSION || !b64) throw new Error("Formato de bóveda desconocido.");
  const raw = Buffer.from(b64, "base64");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAAD(Buffer.from(name, "utf8"));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/** Candado entre procesos (varios comandos del mismo usuario pueden escribir a la vez). */
async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try {
      await (await open(lock, "wx")).close();
      break;
    } catch {
      if (i > 100) await rm(lock, { force: true }); // candado abandonado (proceso muerto)
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

export function createVaultSecretStore(key: Buffer, file: string): SecretStore {
  const id = (service: string, account: string) => `${service}::${account}`;
  const load = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const save = async (data: Record<string, string>) => {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, file);
  };
  return {
    backend: "vault",
    async set(service, account, secret) {
      const name = id(service, account);
      await withLock(file, async () => save({ ...(await load()), [name]: sealSecret(key, name, secret) }));
    },
    async get(service, account) {
      const name = id(service, account);
      const sealed = (await load())[name];
      return sealed ? openSecret(key, name, sealed) : null;
    },
    async delete(service, account) {
      await withLock(file, async () => {
        const data = await load();
        delete data[id(service, account)];
        await save(data);
      });
    },
  };
}
