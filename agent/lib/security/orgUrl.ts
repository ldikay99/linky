/** Validación estricta de organizationUrl Azure DevOps. */
export type ValidatedOrgUrl = {
  organizationUrl: string; // normalizada sin slash final
  organization: string;
  hostStyle: "dev_azure" | "visualstudio";
};

/**
 * Acepta solo:
 * - https://dev.azure.com/{org}
 * - https://{org}.visualstudio.com
 * Rechaza http, paths arbitrarios, userinfo, query, credenciales en URL.
 */
export function validateOrganizationUrl(raw: string): ValidatedOrgUrl {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("organizationUrl inválida: no es una URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("organizationUrl debe usar HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("organizationUrl no debe incluir credenciales.");
  }
  if (url.search || url.hash) {
    throw new Error("organizationUrl no debe incluir query ni hash.");
  }

  const host = url.hostname.toLowerCase();
  if (host === "dev.azure.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) {
      throw new Error("Use https://dev.azure.com/{organizacion} sin rutas adicionales.");
    }
    const organization = decodeURIComponent(parts[0]);
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(organization)) {
      throw new Error("Nombre de organización Azure inválido.");
    }
    return {
      organizationUrl: `https://dev.azure.com/${organization}`,
      organization,
      hostStyle: "dev_azure",
    };
  }

  const vs = host.match(/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.visualstudio\.com$/i);
  if (vs) {
    if (url.pathname && url.pathname !== "/") {
      throw new Error("Use https://{org}.visualstudio.com sin rutas adicionales.");
    }
    const organization = vs[1];
    return {
      organizationUrl: `https://${organization}.visualstudio.com`,
      organization,
      hostStyle: "visualstudio",
    };
  }

  throw new Error(
    "organizationUrl no permitida. Solo https://dev.azure.com/{org} o https://{org}.visualstudio.com",
  );
}

/** Opciones fetch seguras: no seguir redirects (evita exfiltrar Authorization). */
export const SAFE_FETCH_REDIRECT: RequestRedirect = "error";
