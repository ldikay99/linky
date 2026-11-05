/**
 * Almacenes de secretos. Nunca plaintext en disco.
 * Preferido: keyring OS (@napi-rs/keyring).
 * Alternativa explícita: env LINKY_AZURE_PAT o sesión en memoria.
 */
export type SecretBackend = "keyring" | "env" | "session";

export type SecretStore = {
  backend: SecretBackend;
  set(service: string, account: string, secret: string): Promise<void>;
  get(service: string, account: string): Promise<string | null>;
  delete?(service: string, account: string): Promise<void>;
};

const sessionMap = new Map<string, string>();
function sessionKey(service: string, account: string): string {
  return `${service}::${account}`;
}

export function createSessionSecretStore(): SecretStore {
  return {
    backend: "session",
    async set(service, account, secret) {
      sessionMap.set(sessionKey(service, account), secret);
    },
    async get(service, account) {
      return sessionMap.get(sessionKey(service, account)) ?? null;
    },
    async delete(service, account) {
      sessionMap.delete(sessionKey(service, account));
    },
  };
}

export function createEnvSecretStore(envName = "LINKY_AZURE_PAT"): SecretStore {
  return {
    backend: "env",
    async set(_service, _account, secret) {
      process.env[envName] = secret;
    },
    async get() {
      const v = process.env[envName]?.trim();
      return v || null;
    },
    async delete() {
      delete process.env[envName];
    },
  };
}

export async function createKeyringSecretStore(): Promise<SecretStore> {
  const { Entry } = await import("@napi-rs/keyring");
  return {
    backend: "keyring",
    async set(service, account, secret) {
      const entry = new Entry(service, account);
      entry.setPassword(secret);
    },
    async get(service, account) {
      try {
        const entry = new Entry(service, account);
        return entry.getPassword();
      } catch {
        return null;
      }
    },
    async delete(service, account) {
      try {
        const entry = new Entry(service, account);
        entry.deletePassword();
      } catch {
        // ignore missing
      }
    },
  };
}

/** Fake inyectable para tests: no toca disco ni OS keyring. */
export function createFakeSecretStore(initial?: Record<string, string>): SecretStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    backend: "session",
    async set(service, account, secret) {
      map.set(sessionKey(service, account), secret);
    },
    async get(service, account) {
      return map.get(sessionKey(service, account)) ?? null;
    },
    async delete(service, account) {
      map.delete(sessionKey(service, account));
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

export function clearSessionSecretsForTests(): void {
  sessionMap.clear();
}
