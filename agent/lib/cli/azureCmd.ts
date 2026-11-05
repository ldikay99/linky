/**
 * Comandos Azure de conexión y lectura, multi-organización:
 * connect (PAT por org) | login (sesión web) | orgs | use | session | logout | activity.
 */
import { readDayActivity, type DayActivityReport } from "../azure/activity.js";
import { assertAzureAuthenticated, azureAuthHeaders, type AzureAuth } from "../azure/client.js";
import {
  loadAzureOrgs,
  orgKey,
  readOrgPat,
  registerAzureOrg,
  saveOrgPat,
  setPrimaryAzureOrg,
} from "../azure/orgs.js";
import {
  azureCookieHeader,
  clearAzureWebSession,
  loadAzureWebSession,
  loginAzureWithBrowser,
  saveAzureWebSession,
} from "../azure/webSession.js";
import { loadProfile } from "../profile/store.js";
import { readHiddenPrompt } from "../security/hiddenInput.js";
import { validateOrganizationUrl } from "../security/orgUrl.js";
import { readAzurePat } from "../security/secrets.js";
import { resolveRiporSecretStore } from "../ripor/http/session.js";
import { argvHelpers, todayLocalYmd } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

/**
 * Organización: --org > principal registrada > perfil Linky > sesión web legada.
 * Credencial: PAT de esa org → PAT global → sesión web de esa org.
 */
export async function resolveAzureAccess(opts: { org?: string; dataDir?: string }): Promise<{
  organizationUrl: string;
  auth: Pick<AzureAuth, "pat" | "cookie">;
  method: "pat" | "web";
}> {
  const store = await resolveRiporSecretStore();
  const reg = await loadAzureOrgs(opts.dataDir);
  const profile = await loadProfile(opts.dataDir);
  const legacyWeb = opts.org || reg.primary || profile ? null : await loadAzureWebSession(store);
  const raw = opts.org ?? reg.primary ?? profile?.azure.organizationUrl ?? legacyWeb?.organizationUrl;
  if (!raw) throw new Error("Falta organización Azure: azure connect --org https://dev.azure.com/<org> --primary (o azure login).");
  const organizationUrl = validateOrganizationUrl(raw).organizationUrl;

  const orgPat = await readOrgPat(store, organizationUrl);
  if (orgPat) return { organizationUrl, auth: { pat: orgPat }, method: "pat" };
  const web = await loadAzureWebSession(store, organizationUrl);
  const globalPat = await readAzurePat({ dataDir: opts.dataDir }).catch(() => null);
  // El PAT global solo se usa si la org no tiene credencial propia (un PAT suele valer para una sola org).
  if (globalPat && !web) return { organizationUrl, auth: { pat: globalPat }, method: "pat" };
  if (web) return { organizationUrl, auth: { cookie: azureCookieHeader({ ...web, organizationUrl }) }, method: "web" };
  throw new Error(`Sin acceso a ${organizationUrl}: azure connect --org ${organizationUrl} (PAT) o azure login --org ${organizationUrl}.`);
}

async function whoAmI(organizationUrl: string, auth: Pick<AzureAuth, "pat" | "cookie">): Promise<string> {
  const res = await fetch(`${organizationUrl}/_apis/connectionData`, {
    headers: { ...azureAuthHeaders(auth), accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  assertAzureAuthenticated(res);
  if (!res.ok) throw new Error(`connectionData HTTP ${res.status}`);
  const data = (await res.json()) as { authenticatedUser?: { providerDisplayName?: string; descriptor?: string } };
  if (!data.authenticatedUser || /anonymous/i.test(data.authenticatedUser.descriptor ?? "")) {
    throw new Error("Credencial no válida para esta organización.");
  }
  return data.authenticatedUser.providerDisplayName ?? "";
}

function print(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

export async function runAzureCommand(sub: string | undefined, a: Argv, dataDir?: string): Promise<void> {
  const store = await resolveRiporSecretStore();
  const orgArg = a.arg("--org");

  if (sub === "connect") {
    if (!orgArg) throw new Error("azure connect --org https://dev.azure.com/<org> [--primary] [--label <nombre>]");
    const organizationUrl = validateOrganizationUrl(orgArg).organizationUrl;
    // PAT: entrada oculta; en entornos sin TTY, variable explícita LINKY_AZURE_PAT_INPUT (no se persiste en disco).
    const fromEnv = process.env.LINKY_AZURE_PAT_INPUT?.trim();
    delete process.env.LINKY_AZURE_PAT_INPUT;
    const pat = fromEnv || (await readHiddenPrompt(`PAT para ${organizationUrl} (no se mostrará): `));
    const user = await whoAmI(organizationUrl, { pat });
    await saveOrgPat(store, organizationUrl, pat);
    const reg = await registerAzureOrg(
      { organizationUrl, auth: "pat", label: a.arg("--label") },
      { primary: a.has("--primary"), dataDir },
    );
    print({ ok: true, organizationUrl, user, primary: reg.primary, backend: store.backend });
    return;
  }

  if (sub === "login") {
    const session = await loginAzureWithBrowser({ organizationUrl: orgArg, channel: a.arg("--channel") });
    await saveAzureWebSession(session, store);
    const reg = await registerAzureOrg(
      { organizationUrl: session.organizationUrl, auth: "web", label: a.arg("--label") },
      { primary: a.has("--primary"), dataDir },
    );
    print({ ok: true, organizationUrl: session.organizationUrl, user: session.userDisplayName, primary: reg.primary });
    return;
  }

  if (sub === "use") {
    if (!orgArg) throw new Error("azure use --org https://dev.azure.com/<org>");
    print(await setPrimaryAzureOrg(orgArg, dataDir));
    return;
  }

  if (sub === "orgs" || sub === "session") {
    const reg = await loadAzureOrgs(dataDir);
    const rows = [];
    for (const o of reg.orgs) {
      let status: string;
      try {
        const access = await resolveAzureAccess({ org: o.organizationUrl, dataDir });
        status = `${access.method}: ${await whoAmI(access.organizationUrl, access.auth)}`;
      } catch (e) {
        status = `sin acceso (${(e as Error).message.split(".")[0]})`;
      }
      rows.push({ ...o, primary: reg.primary === o.organizationUrl, status });
    }
    print({ primary: reg.primary ?? null, orgs: rows });
    return;
  }

  if (sub === "logout") {
    await clearAzureWebSession(store, orgArg);
    if (orgArg && store.delete) await store.delete("linky-azure-devops", `pat:${orgKey(orgArg)}`);
    print({ ok: true, message: `Credenciales locales eliminadas${orgArg ? ` para ${orgArg}` : " (sesión web)"}. Revoca el PAT en Azure si ya no lo usas.` });
    return;
  }

  if (sub === "activity") {
    const dateYmd = a.arg("--date") ?? todayLocalYmd();
    const reg = await loadAzureOrgs(dataDir);
    const targets = a.has("--all") ? reg.orgs.map((o) => o.organizationUrl) : [orgArg];
    const reports: Array<DayActivityReport & { organizationUrl: string; method: string }> = [];
    const errors: Array<{ organizationUrl?: string; error: string }> = [];
    for (const org of targets) {
      try {
        const access = await resolveAzureAccess({ org, dataDir });
        const r = await readDayActivity({ organizationUrl: access.organizationUrl, auth: access.auth, dateYmd });
        reports.push({ organizationUrl: access.organizationUrl, method: access.method, ...r });
      } catch (e) {
        errors.push({ organizationUrl: org, error: (e as Error).message });
      }
    }
    print(a.has("--all") ? { dateYmd, reports, errors } : reports[0] ?? { errors });
    if (!reports.length) process.exitCode = 1;
    return;
  }

  console.log(`linky azure <connect|login|orgs|use|logout|activity>
  connect --org https://dev.azure.com/<org> [--primary]   PAT (preferido), entrada oculta
  login   [--org …] [--primary]                           sesión web (navegador visible, una vez)
  orgs                                                    organizaciones conectadas y cuál es la principal
  use     --org …                                         cambiar la principal
  activity [--date YYYY-MM-DD] [--org … | --all]          lo que hiciste ese día`);
  if (sub) process.exitCode = 1;
}
