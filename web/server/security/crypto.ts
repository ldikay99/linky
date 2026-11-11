/**
 * Cifrado de todo lo que la web guarda (conversaciones, títulos, adjuntos, aprobaciones).
 * AES-256-GCM con una clave por persona y propósito derivada de la maestra (HKDF-SHA256);
 * el identificador del registro va como AAD, así un dato no se puede mover a otro registro.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = 1;

export type Purpose = "data" | "files" | "vault";

export class KeyRing {
  readonly #master: Buffer;
  readonly #cache = new Map<string, Buffer>();

  constructor(master: Buffer) {
    if (master.length !== 32) throw new Error("La clave maestra debe ser de 32 bytes.");
    this.#master = master;
  }

  key(userId: string, purpose: Purpose): Buffer {
    const id = `${userId}:${purpose}`;
    let k = this.#cache.get(id);
    if (!k) {
      k = Buffer.from(hkdfSync("sha256", this.#master, Buffer.from(userId, "utf8"), `linky-web/${purpose}/v1`, 32));
      this.#cache.set(id, k);
    }
    return k;
  }

  seal(userId: string, purpose: Purpose, aad: string, plain: Buffer | string): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key(userId, purpose), iv);
    c.setAAD(Buffer.from(aad, "utf8"));
    const body = Buffer.concat([c.update(typeof plain === "string" ? Buffer.from(plain, "utf8") : plain), c.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), body]);
  }

  open(userId: string, purpose: Purpose, aad: string, sealed: Buffer): Buffer {
    if (sealed[0] !== VERSION) throw new Error("Versión de cifrado desconocida.");
    const d = createDecipheriv("aes-256-gcm", this.key(userId, purpose), sealed.subarray(1, 13));
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(sealed.subarray(13, 29));
    return Buffer.concat([d.update(sealed.subarray(29)), d.final()]);
  }

  sealJson(userId: string, aad: string, value: unknown): Buffer {
    return this.seal(userId, "data", aad, JSON.stringify(value));
  }

  openJson<T>(userId: string, aad: string, sealed: Buffer): T {
    return JSON.parse(this.open(userId, "data", aad, sealed).toString("utf8")) as T;
  }
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Clave maestra: variable de entorno o, en modo single, el llavero del sistema (se crea la primera vez). */
export async function resolveMasterKey(fromEnv: string | undefined): Promise<Buffer> {
  if (fromEnv) {
    const k = Buffer.from(fromEnv.trim(), "base64");
    if (k.length !== 32) throw new Error("LINKY_WEB_MASTER_KEY debe ser de 32 bytes en base64.");
    return k;
  }
  const { Entry } = await import("@napi-rs/keyring");
  const entry = new Entry("linky-web", "master-key");
  let stored: string | null = null;
  try {
    stored = entry.getPassword();
  } catch {
    stored = null;
  }
  if (stored) return Buffer.from(stored, "base64");
  const k = randomBytes(32);
  entry.setPassword(k.toString("base64"));
  return k;
}
