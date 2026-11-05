/**
 * Sesión web de Azure DevOps (alternativa al PAT): cookies de dev.azure.com
 * obtenidas con `azure login` (navegador visible, una vez). Solo en keyring/memoria.
 */
import { clearChunkedSecret, loadChunkedSecret, saveChunkedSecret } from "../security/chunkedSecret.js";
import { validateOrganizationUrl } from "../security/orgUrl.js";
import type { SecretStore } from "../security/secretStore.js";
import { orgKey, webSessionService } from "./orgs.js";

/** Servicio legado (una sola org); se sigue leyendo por compatibilidad. */
export const AZURE_WEB_SECRET_SERVICE = "linky-azure-web";

export type AzureWebCookie = { name: string; value: string; domain: string };

export type AzureWebSession = {
  organizationUrl: string;
  cookies: AzureWebCookie[];
  savedAt: string;
  userDisplayName?: string;
};

/** Header Cookie solo con las cookies aplicables al host de la organización. */
export function azureCookieHeader(session: AzureWebSession): string {
  const host = new URL(session.organizationUrl).hostname;
  return session.cookies
    .filter((c) => {
      const d = c.domain.replace(/^\./, "");
      return host === d || host.endsWith(`.${d}`);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export async function saveAzureWebSession(session: AzureWebSession, store: SecretStore): Promise<void> {
  validateOrganizationUrl(session.organizationUrl);
  await saveChunkedSecret(store, webSessionService(session.organizationUrl), JSON.stringify({ cookies: session.cookies }), {
    savedAt: session.savedAt,
    source: "browser",
    extra: { organizationUrl: session.organizationUrl, userDisplayName: session.userDisplayName ?? "" },
  });
}

export async function loadAzureWebSession(store: SecretStore, organizationUrl?: string): Promise<AzureWebSession | null> {
  let loaded = organizationUrl ? await loadChunkedSecret(store, webSessionService(organizationUrl)) : null;
  if (!loaded) {
    loaded = await loadChunkedSecret(store, AZURE_WEB_SECRET_SERVICE);
    const legacyOrg = loaded?.meta.extra?.organizationUrl;
    if (organizationUrl && legacyOrg && orgKey(legacyOrg) !== orgKey(organizationUrl)) return null;
  }
  if (!loaded?.meta.extra?.organizationUrl) return null;
  try {
    const { cookies } = JSON.parse(loaded.payload) as { cookies: AzureWebCookie[] };
    return {
      organizationUrl: loaded.meta.extra.organizationUrl,
      cookies,
      savedAt: loaded.meta.savedAt,
      userDisplayName: loaded.meta.extra.userDisplayName || undefined,
    };
  } catch {
    return null;
  }
}

export async function clearAzureWebSession(store: SecretStore, organizationUrl?: string): Promise<void> {
  if (organizationUrl) await clearChunkedSecret(store, webSessionService(organizationUrl));
  await clearChunkedSecret(store, AZURE_WEB_SECRET_SERVICE);
}

/**
 * Login visual: abre dev.azure.com (o la org indicada), espera a que la sesión
 * responda en la API (connectionData autenticado) y devuelve las cookies.
 */
export async function loginAzureWithBrowser(opts?: {
  organizationUrl?: string;
  channel?: string;
  timeoutMs?: number;
  log?: (msg: string) => void;
}): Promise<AzureWebSession> {
  const { launchVisibleBrowser, waitForLogin } = await import("../browser/launch.js");
  const log = opts?.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const vb = await launchVisibleBrowser({ channel: opts?.channel });
  try {
    await vb.page.goto(opts?.organizationUrl ?? "https://dev.azure.com/");
    log("Inicia sesión en Azure DevOps en la ventana y entra a tu organización. Se cerrará sola.");
    return await waitForLogin(
      vb,
      async () => {
        const url = new URL(vb.page.url());
        if (url.hostname !== "dev.azure.com") return undefined;
        const org = url.pathname.split("/").filter(Boolean)[0];
        if (!org || org.startsWith("_")) return undefined;
        const organizationUrl = validateOrganizationUrl(
          opts?.organizationUrl ?? `https://dev.azure.com/${org}`,
        ).organizationUrl;
        const res = await vb.context.request.get(`${organizationUrl}/_apis/connectionData`, {
          headers: { "X-TFS-FedAuthRedirect": "Suppress", accept: "application/json" },
          maxRedirects: 0,
        });
        if (res.status() !== 200) return undefined;
        const data = (await res.json().catch(() => null)) as
          | { authenticatedUser?: { providerDisplayName?: string; descriptor?: string } }
          | null;
        const user = data?.authenticatedUser;
        if (!user || /anonymous/i.test(user.descriptor ?? "")) return undefined;
        const cookies = (await vb.context.cookies(organizationUrl)).map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
        }));
        return { organizationUrl, cookies, savedAt: new Date().toISOString(), userDisplayName: user.providerDisplayName };
      },
      opts?.timeoutMs,
    );
  } finally {
    await vb.browser.close().catch(() => undefined);
  }
}
