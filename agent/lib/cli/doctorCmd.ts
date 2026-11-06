/**
 * `linky doctor`: estado de TODO en una llamada, con el arreglo exacto para cada problema.
 * Pensado para que la IA sepa qué falta sin probar comando por comando. No escribe nada.
 */
import { loadAzureOrgs } from "../azure/orgs.js";
import { openSharedBrowser } from "../browser/shared.js";
import { hasGoogleSession } from "../chat/browser.js";
import { loadChatConfig } from "../chat/config.js";
import { loadProfile } from "../profile/store.js";
import { describeRiporSession, loadRiporSession, resolveRiporSecretStore } from "../ripor/http/session.js";
import { loadRiporProfile } from "../ripor/profileStore.js";
import { loadRiporJournal, riporJournalBlocksMutations } from "../ripor/journal.js";
import { evaluatePatReminder } from "../security/patLifecycle.js";
import { resolveAzureAccess, whoAmI } from "./azureCmd.js";

export type Check = { area: string; ok: boolean; detail: string; fix?: string };

async function attempt(area: string, fn: () => Promise<Omit<Check, "area">>): Promise<Check> {
  try {
    return { area, ...(await fn()) };
  } catch (e) {
    return { area, ok: false, detail: String((e as Error).message || e).split("\n")[0].slice(0, 200) };
  }
}

export async function runDoctor(opts: { dataDir?: string; skipBrowser?: boolean }): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ area: "node", ok: major >= 24, detail: `Node ${process.versions.node}`, fix: major >= 24 ? undefined : "Instala Node.js 24+" });

  checks.push(
    await attempt("navegador", async () => {
      await import("playwright-core");
      return { ok: true, detail: "playwright-core instalado (solo para logins y Google)" };
    }),
  );

  checks.push(
    await attempt("llavero", async () => {
      const store = await resolveRiporSecretStore();
      await store.get("linky-doctor", "probe");
      return { ok: true, detail: `secretos en ${store.backend}` };
    }),
  );

  // Azure: cada organización conectada + perfil de trabajo + vencimiento del PAT.
  const reg = await loadAzureOrgs(opts.dataDir);
  if (!reg.orgs.length) {
    checks.push({ area: "azure", ok: false, detail: "Sin organizaciones conectadas", fix: "npm run linky -- azure connect --org https://dev.azure.com/<org> --primary" });
  }
  for (const o of reg.orgs) {
    checks.push(
      await attempt(`azure ${o.organizationUrl}${reg.primary === o.organizationUrl ? " (principal)" : ""}`, async () => {
        const access = await resolveAzureAccess({ org: o.organizationUrl, dataDir: opts.dataDir });
        return { ok: true, detail: `${access.method}: ${await whoAmI(access.organizationUrl, access.auth)}` };
      }).then((c) => (c.ok ? c : { ...c, fix: `npm run linky -- azure connect --org ${o.organizationUrl}` })),
    );
  }
  const profile = await loadProfile(opts.dataDir);
  if (!profile) {
    checks.push({ area: "azure perfil", ok: false, detail: "Sin onboarding de Azure (proyecto, rol, horario)", fix: "npm run linky -- onboarding --answers <json>" });
  } else {
    const r = profile.patLifecycle ? evaluatePatReminder(profile.patLifecycle) : null;
    checks.push({
      area: "azure perfil",
      ok: !r || r.level === "ok",
      detail: `${profile.azure.project}${r ? ` · PAT: ${r.message}` : ""}`,
      fix: r && r.level !== "ok" ? "Crea un PAT nuevo (Full access, 90 días) y ejecuta azure connect + onboarding" : undefined,
    });
  }

  // Ripor: setup + sesión + journal.
  const rp = await loadRiporProfile(opts.dataDir);
  checks.push(
    rp?.setupComplete
      ? { area: "ripor setup", ok: true, detail: `${rp.areaProject?.label} · ${rp.defaultTaskLabel} · ${rp.defaultTransport?.label}` }
      : { area: "ripor setup", ok: false, detail: "Sin setup de Ripor", fix: "npm run linky -- ripor catalog --from-date <día ya reportado> && ripor setup --answers …" },
  );
  checks.push(
    await attempt("ripor sesión", async () => {
      const s = describeRiporSession(await loadRiporSession(await resolveRiporSecretStore()));
      return s.present
        ? { ok: true, detail: `sesión guardada (${s.source}); se renueva sola al usarla` }
        : { ok: false, detail: "Sin sesión", fix: "npm run linky -- ripor login" };
    }),
  );
  const journal = riporJournalBlocksMutations(await loadRiporJournal(opts.dataDir));
  checks.push({ area: "ripor journal", ok: !journal.blocked, detail: journal.blocked ? journal.reason! : "sin operaciones pendientes", fix: journal.blocked ? "npm run linky -- ripor reconcile" : undefined });

  // Google (Chat/Calendar) y chat configurado.
  if (!opts.skipBrowser) {
    checks.push(
      await attempt("google", async () => {
        const ctx = await openSharedBrowser({ headless: true, dataDir: opts.dataDir });
        try {
          const ok = await hasGoogleSession(ctx);
          return ok ? { ok, detail: "sesión de Google activa (Chat, Calendar, Ripor con Google)" } : { ok, detail: "Sin sesión de Google", fix: "npm run linky -- google login" };
        } finally {
          await ctx.close().catch(() => undefined);
        }
      }),
    );
  }
  const chat = await loadChatConfig(opts.dataDir);
  checks.push(
    chat
      ? { area: "chat", ok: true, detail: `${chat.target.title ?? chat.target.url}${Object.keys(chat.templates ?? {}).length ? " · plantilla propia" : " · plantilla por defecto"}` }
      : { area: "chat", ok: false, detail: "Sin chat de reporte (opcional)", fix: "npm run linky -- chat login" },
  );

  // "chat" es opcional: no hace fallar el diagnóstico.
  return { ok: checks.filter((c) => c.area !== "chat").every((c) => c.ok), checks };
}
