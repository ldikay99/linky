/**
 * Varias organizaciones Azure DevOps por persona (p. ej. la de su empresa + la de un cliente/consorcio).
 * Registro SIN secretos en ~/.linky/azure-orgs.json; credenciales por organización en keyring:
 *   PAT       → service "linky-azure-devops", account "pat:<org>"  (fallback: account "pat" global)
 *   Sesión web → service "linky-azure-web:<org>"
 * La organización PRINCIPAL es el default; otra solo si el usuario la pide.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";
import { validateOrganizationUrl } from "../security/orgUrl.js";
import { LINKY_SECRET_ACCOUNT, LINKY_SECRET_SERVICE } from "../security/secrets.js";
import type { SecretStore } from "../security/secretStore.js";

export type AzureOrgEntry = { organizationUrl: string; auth: "pat" | "web"; label?: string };
export type AzureOrgRegistry = { primary?: string; orgs: AzureOrgEntry[] };

const registryPath = (dataDir?: string) => path.join(linkyDataDir(dataDir), "azure-orgs.json");

export function orgKey(organizationUrl: string): string {
  return validateOrganizationUrl(organizationUrl).organization.toLowerCase();
}

export async function loadAzureOrgs(dataDir?: string): Promise<AzureOrgRegistry> {
  try {
    return JSON.parse(await readFile(registryPath(dataDir), "utf8")) as AzureOrgRegistry;
  } catch {
    return { orgs: [] };
  }
}

export async function registerAzureOrg(
  entry: AzureOrgEntry,
  opts: { primary?: boolean; dataDir?: string },
): Promise<AzureOrgRegistry> {
  const organizationUrl = validateOrganizationUrl(entry.organizationUrl).organizationUrl;
  const reg = await loadAzureOrgs(opts.dataDir);
  const others = reg.orgs.filter((o) => orgKey(o.organizationUrl) !== orgKey(organizationUrl));
  const next: AzureOrgRegistry = {
    primary: opts.primary || !reg.primary ? organizationUrl : reg.primary,
    orgs: [...others, { ...entry, organizationUrl }],
  };
  await mkdir(linkyDataDir(opts.dataDir), { recursive: true, mode: 0o700 });
  await writeFile(registryPath(opts.dataDir), JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return next;
}

export async function setPrimaryAzureOrg(organizationUrl: string, dataDir?: string): Promise<AzureOrgRegistry> {
  const reg = await loadAzureOrgs(dataDir);
  const found = reg.orgs.find((o) => orgKey(o.organizationUrl) === orgKey(organizationUrl));
  if (!found) throw new Error(`Organización no registrada: ${organizationUrl}. Conéctala primero (azure connect / azure login).`);
  return registerAzureOrg(found, { primary: true, dataDir });
}

export async function saveOrgPat(store: SecretStore, organizationUrl: string, pat: string): Promise<void> {
  await store.set(LINKY_SECRET_SERVICE, `${LINKY_SECRET_ACCOUNT}:${orgKey(organizationUrl)}`, pat.trim());
}

/** PAT de la organización; si no hay, el PAT global (onboarding clásico). */
export async function readOrgPat(store: SecretStore, organizationUrl: string): Promise<string | null> {
  return (
    (await store.get(LINKY_SECRET_SERVICE, `${LINKY_SECRET_ACCOUNT}:${orgKey(organizationUrl)}`)) ??
    null
  );
}

export function webSessionService(organizationUrl: string): string {
  return `linky-azure-web:${orgKey(organizationUrl)}`;
}
