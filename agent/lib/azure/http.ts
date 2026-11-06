/**
 * Lecturas Azure (GET y consultas WIQL/batch, que no modifican nada) con reintento ante fallos de red
 * pasajeros. Las ESCRITURAS no usan esto: ahí manda el journal fail-closed (nunca reintentar a ciegas).
 */
import { assertAzureAuthenticated, AzureSessionExpiredError } from "./client.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function azureReadJson<T>(
  doFetch: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await doFetch(url, {
        method: body ? "POST" : "GET",
        headers: body ? { ...headers, "content-type": "application/json" } : headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      assertAzureAuthenticated(res);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`Azure ${new URL(url).pathname}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { final: true });
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof AzureSessionExpiredError || (e as { final?: boolean }).final) throw e;
      lastError = e;
      if (i < attempts - 1) await sleep(400 * 2 ** i);
    }
  }
  throw new Error(`Azure ${new URL(url).pathname}: ${String((lastError as Error)?.message ?? lastError)} (tras ${attempts} intentos)`);
}
