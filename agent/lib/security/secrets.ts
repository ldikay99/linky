import { access } from "node:fs/promises";
import path from "node:path";
import { secretsDir } from "./paths.js";
import {
  createEnvSecretStore,
  createKeyringSecretStore,
  createSessionSecretStore,
  type SecretBackend,
  type SecretStore,
} from "./secretStore.js";

export const LINKY_SECRET_SERVICE = "linky-azure-devops";
export const LINKY_SECRET_ACCOUNT = "pat";

export type SavePatResult = {
  backend: SecretBackend;
  /** Descriptor sin secreto. */
  locator: string;
};

function assertPatShape(pat: string): string {
  if (!pat || !pat.trim()) throw new Error("PAT vacío: no se guarda.");
  const trimmed = pat.trim();
  if (/^(your|xxx|changeme|example|synthetic-pat)/i.test(trimmed) && !process.env.LINKY_ALLOW_SYNTHETIC_PAT) {
    // En producción rechaza placeholders; tests setean LINKY_ALLOW_SYNTHETIC_PAT=1
    if (!/^synthetic-pat-/i.test(trimmed)) {
      throw new Error("PAT parece un placeholder; introduce un token real de forma local.");
    }
  }
  return trimmed;
}

/**
 * Guarda PAT en keyring OS. Si keyring no está disponible, SOLO permite
 * backend explícito env|session (nunca archivo plaintext).
 */
export async function saveAzurePat(
  pat: string,
  opts?: {
    store?: SecretStore;
    /** Fuerza env/session cuando keyring falla o en CI. */
    fallbackBackend?: "env" | "session";
    dataDir?: string;
  },
): Promise<SavePatResult> {
  const trimmed = assertPatShape(pat);
  await assertNoLegacyPlaintextSecretFile(opts?.dataDir);

  if (opts?.store) {
    await opts.store.set(LINKY_SECRET_SERVICE, LINKY_SECRET_ACCOUNT, trimmed);
    return { backend: opts.store.backend, locator: describeBackend(opts.store.backend) };
  }

  try {
    const keyring = await createKeyringSecretStore();
    await keyring.set(LINKY_SECRET_SERVICE, LINKY_SECRET_ACCOUNT, trimmed);
    return { backend: "keyring", locator: describeBackend("keyring") };
  } catch (e) {
    const reason = (e as Error).message || String(e);
    const fb = opts?.fallbackBackend ?? (process.env.LINKY_SECRET_BACKEND as "env" | "session" | undefined);
    if (fb === "env") {
      const envStore = createEnvSecretStore();
      await envStore.set(LINKY_SECRET_SERVICE, LINKY_SECRET_ACCOUNT, trimmed);
      return { backend: "env", locator: describeBackend("env") };
    }
    if (fb === "session") {
      const session = createSessionSecretStore();
      await session.set(LINKY_SECRET_SERVICE, LINKY_SECRET_ACCOUNT, trimmed);
      return { backend: "session", locator: describeBackend("session") };
    }
    throw new Error(
      `No se pudo usar el keyring del sistema (${reason}). ` +
        `No hay fallback a archivo. Configure el keyring, o use explícitamente ` +
        `LINKY_SECRET_BACKEND=env (variable LINKY_AZURE_PAT) o LINKY_SECRET_BACKEND=session.`,
    );
  }
}

export async function readAzurePat(opts?: { store?: SecretStore; dataDir?: string }): Promise<string | null> {
  await assertNoLegacyPlaintextSecretFile(opts?.dataDir);

  const fromEnv = process.env.LINKY_AZURE_PAT?.trim();
  if (fromEnv) return fromEnv;

  if (opts?.store) {
    return opts.store.get(LINKY_SECRET_SERVICE, LINKY_SECRET_ACCOUNT);
  }

  // Sesión en memoria
  const session = createSessionSecretStore();
  const fromSession = await session.get(LINKY_SECRET_SERVICE, LINKY_SECRET_ACCOUNT);
  if (fromSession) return fromSession;

  try {
    const keyring = await createKeyringSecretStore();
    return await keyring.get(LINKY_SECRET_SERVICE, LINKY_SECRET_ACCOUNT);
  } catch {
    return null;
  }
}

/** Nunca imprime fragmentos del token. */
export function patStatusLabel(present: boolean): string {
  return present ? "PAT configurado" : "PAT no configurado";
}

export function assertNoSecretInObject(obj: unknown, forbiddenExact: string[] = []): void {
  const json = JSON.stringify(obj);
  for (const s of forbiddenExact) {
    if (s && s.length >= 8 && json.includes(s)) {
      throw new Error("Se detectó un secreto en un objeto que no debe persistirlo.");
    }
  }
}

function describeBackend(backend: SecretBackend): string {
  if (backend === "keyring") return "os-keyring:linky-azure-devops/pat";
  if (backend === "env") return "env:LINKY_AZURE_PAT";
  return "session:memory";
}

async function assertNoLegacyPlaintextSecretFile(dataDir?: string): Promise<void> {
  const legacy = path.join(secretsDir(dataDir), "azure-pat");
  try {
    await access(legacy);
    throw new Error(
      `Se encontró un PAT en texto plano legado en ${legacy}. Elimínelo y vuelva a guardar con keyring/env/session.`,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    if (String((e as Error).message || e).includes("texto plano legado")) throw e;
  }
}
