#!/usr/bin/env node
/**
 * CLI determinista de Linky (sin IA pagada).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHttpAzureClient, createMockAzureClient } from "../azure/client.js";
import { runOnboarding, type OnboardingAnswers } from "../onboarding/wizard.js";
import { loadProfile, profileExistsSummary } from "../profile/store.js";
import { buildDayPlan, type DayInput } from "../planning/day.js";
import { previewDayChanges } from "../apply/preview.js";
import { applyPreview, reconcileClientKey } from "../apply/apply.js";
import { writeDayMessageDrafts } from "../messaging/drafts.js";
import { readAzurePat, patStatusLabel } from "../security/secrets.js";
import { evaluatePatReminder } from "../security/patLifecycle.js";
import { planLocalOsReminder } from "../security/localReminder.js";
import { createSessionSecretStore } from "../security/secretStore.js";
import { linkyDataDir } from "../security/paths.js";
import { checkObservedRipor, gateObservedRipor, type UiCheckInput } from "../ripor/uiCheck.js";
import { writeBrowserSetup, browserSetupStatus } from "../browser/setup.js";
import type { ApplyPreview } from "../types.js";
import {
  buildRiporProfileFromSetup,
  type RiporSetupInput,
} from "../ripor/setup.js";
import { loadRiporProfile, saveRiporProfile, loadOrEmptyRiporProfile } from "../ripor/profileStore.js";
import { previewRiporMutation, applyRiporMutation } from "../ripor/apply.js";
import { createMockRiporUiAdapter, createUnimplementedRiporAdapter } from "../browser/adapter.js";
import { RIPOR_PUBLIC_URL, type RiporDraftFields, type RiporApproval } from "../ripor/types.js";
import { loadRiporJournal, riporJournalBlocksMutations } from "../ripor/journal.js";
import { defaultBrowserCapabilities } from "../browser/capabilities.js";
import { riporBrowserProfileDir } from "../browser/paths.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function dataDir(): string | undefined {
  return arg("--data-dir") ?? process.env.LINKY_DATA_DIR;
}

async function cmdOnboarding() {
  const answersFile = arg("--answers");
  if (!answersFile) throw new Error("Falta --answers <json>");
  const answers = await readJson<OnboardingAnswers>(answersFile);
  const useMock = has("--mock") || process.env.LINKY_AZURE_MODE === "mock";

  const fallback =
    (arg("--secret-backend") as "env" | "session" | undefined) ||
    (process.env.LINKY_SECRET_BACKEND as "env" | "session" | undefined);

  const result = await runOnboarding(answers, {
    dataDir: dataDir(),
    secretFallbackBackend: fallback ?? (useMock ? "session" : undefined),
    secretStore: useMock && !fallback ? createSessionSecretStore() : undefined,
    createClient: (org, project, pat) => {
      if (useMock) return createMockAzureClient().client;
      return createHttpAzureClient({ organizationUrl: org, project, pat });
    },
  });
  console.log(
    JSON.stringify(
      {
        profilePath: result.profilePath,
        summary: profileExistsSummary(result.profile),
        permissionNotes: result.permissionNotes,
        fieldNotes: result.fieldNotes,
        secretBackend: result.secretBackend,
        pat: patStatusLabel(true),
        fullAccessWarning: result.fullAccessWarning ?? null,
        patLifecycle: result.profile.patLifecycle
          ? {
              dateSource: result.profile.patLifecycle.dateSource,
              expiresOn: result.profile.patLifecycle.expiresOn,
              scopeChoice: result.profile.patLifecycle.scopeChoice,
              deviceTimeZone: result.profile.patLifecycle.deviceTimeZone,
            }
          : null,
        mode: useMock ? "mock" : "http",
      },
      null,
      2,
    ),
  );
}

async function loadClientForProfile() {
  const profile = await loadProfile(dataDir());
  if (!profile) throw new Error("No hay perfil. Ejecuta onboarding primero.");
  const useMock = has("--mock") || process.env.LINKY_AZURE_MODE === "mock";
  if (useMock) return { profile, client: createMockAzureClient().client, mode: "mock" as const };
  const pat = await readAzurePat();
  if (!pat) {
    throw new Error("No hay PAT (keyring / LINKY_AZURE_PAT / sesión). No se usa archivo plaintext.");
  }
  return {
    profile,
    client: createHttpAzureClient({
      organizationUrl: profile.azure.organizationUrl,
      project: profile.azure.project,
      pat,
    }),
    mode: "http" as const,
  };
}

async function cmdPlan() {
  const dayFile = arg("--day");
  if (!dayFile) throw new Error("Falta --day <json>");
  const profile = await loadProfile(dataDir());
  if (!profile) throw new Error("No hay perfil. Ejecuta onboarding primero.");
  const input = await readJson<DayInput>(dayFile);
  const plan = buildDayPlan(profile, input);
  console.log(JSON.stringify(plan, null, 2));
}

async function cmdPreview() {
  const dayFile = arg("--day");
  if (!dayFile) throw new Error("Falta --day <json>");
  const { profile, client, mode } = await loadClientForProfile();
  const input = await readJson<DayInput>(dayFile);
  const plan = buildDayPlan(profile, input);
  const intentsRaw = arg("--intents");
  const intents = intentsRaw
    ? (JSON.parse(intentsRaw) as Record<string, "entregado" | "cerrado" | "en_curso" | "planeado">)
    : undefined;
  const preview = await previewDayChanges(profile, plan, client, {
    intents,
    allowHuCreate: has("--allow-hu-create"),
  });
  const out = arg("--out") ?? path.join(linkyDataDir(dataDir()), "last-preview.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(preview, null, 2));
  console.log(
    JSON.stringify(
      { mode, out, snapshotHash: preview.snapshotHash, humanSummary: preview.humanSummary, changes: preview.changes.length },
      null,
      2,
    ),
  );
}

async function cmdApply() {
  if (!has("--approve")) throw new Error("Apply requiere --approve (autorización explícita).");
  const by = arg("--by");
  if (!by) throw new Error("Falta --by <quien-aprueba>");
  const previewFile = arg("--preview");
  if (!previewFile) throw new Error("Falta --preview <json>");
  const preview = await readJson<ApplyPreview>(previewFile);
  const hash = arg("--snapshot") ?? preview.snapshotHash;
  if (!hash) throw new Error("Falta snapshotHash (--snapshot o en el preview).");
  const { client, mode, profile } = await loadClientForProfile();
  const result = await applyPreview(
    client,
    preview,
    { approved: true, approvedBy: by, approvedSnapshotHash: hash, note: arg("--note") },
    { dataDir: dataDir(), profile },
  );
  console.log(JSON.stringify({ mode, result }, null, 2));
}

async function cmdReconcile() {
  const key = arg("--key");
  if (!key) throw new Error("Falta --key <clientKey>");
  const { client, mode } = await loadClientForProfile();
  const result = await reconcileClientKey(client, key, dataDir());
  console.log(JSON.stringify({ mode, result }, null, 2));
}

async function cmdDrafts() {
  const dayFile = arg("--day");
  if (!dayFile) throw new Error("Falta --day <json>");
  const profile = await loadProfile(dataDir());
  if (!profile) throw new Error("No hay perfil.");
  const input = await readJson<DayInput>(dayFile);
  const plan = buildDayPlan(profile, input);
  const drafts = await writeDayMessageDrafts(profile, plan, dataDir());
  console.log(JSON.stringify(drafts, null, 2));
}

async function cmdStatus() {
  const profile = await loadProfile(dataDir());
  if (!profile) {
    console.log(JSON.stringify({ configured: false, dataDir: linkyDataDir(dataDir()) }, null, 2));
    return;
  }
  const pat = await readAzurePat();
  const reminder = profile.patLifecycle
    ? evaluatePatReminder(profile.patLifecycle)
    : null;
  const osReminder = profile.patLifecycle ? planLocalOsReminder(profile.patLifecycle) : null;
  console.log(
    JSON.stringify(
      {
        configured: true,
        dataDir: linkyDataDir(dataDir()),
        summary: profileExistsSummary(profile),
        pat: patStatusLabel(Boolean(pat)),
        secretBackend: profile.secretBackend ?? null,
        schedulingEnabled: profile.messaging.schedulingEnabled,
        patReminder: reminder,
        localOsReminderPlan: osReminder,
      },
      null,
      2,
    ),
  );
}


function riporAdapter() {
  if (has("--mock") || process.env.LINKY_RIPOR_MODE === "mock") {
    return createMockRiporUiAdapter();
  }
  // Honest: no fingir Playwright operativo en este proceso CLI sin inyección.
  return createUnimplementedRiporAdapter();
}

async function cmdRiporSetup() {
  const answersFile = arg("--answers");
  if (!answersFile) throw new Error("Falta --answers <ripor-setup.json>");
  const answers = await readJson<RiporSetupInput>(answersFile);
  const result = buildRiporProfileFromSetup(answers);
  if (!result.ok || !result.profile) {
    console.log(JSON.stringify({ ok: false, errors: result.errors, warnings: result.warnings }, null, 2));
    process.exit(1);
  }
  const p = await saveRiporProfile(result.profile, dataDir());
  console.log(
    JSON.stringify(
      {
        ok: true,
        path: p,
        publicUrl: RIPOR_PUBLIC_URL,
        areaProject: result.profile.areaProject,
        defaultTaskLabel: result.profile.defaultTaskLabel,
        defaultTransport: result.profile.defaultTransport,
        azureProjectHints: result.profile.azureProjectHints,
        schedule: result.profile.schedule,
        warnings: result.warnings,
        browserProfileDir: riporBrowserProfileDir(dataDir()),
        capabilities: defaultBrowserCapabilities(),
      },
      null,
      2,
    ),
  );
}

async function cmdRiporPreview() {
  const draftFile = arg("--draft");
  if (!draftFile) throw new Error("Falta --draft <json>");
  const payload = await readJson<{
    op?: "create" | "update" | "delete";
    dateYmd: string;
    draft?: RiporDraftFields;
    reportId?: string;
    activitiesCoverFullDay?: boolean;
    sustainedActivityHours?: number;
    coverageProof?: {
      sustainedActivityHours: number;
      coversDraftDedication: true;
      source: "azure_confirmed";
    };
  }>(draftFile);
  const profile = await loadRiporProfile(dataDir());
  if (!profile?.setupComplete) throw new Error("Falta ripor setup.");
  const op = payload.op ?? "create";
  const adapter = riporAdapter();
  if (adapter.kind === "unimplemented" && !has("--mock")) {
    console.error(
      "AVISO: adapter unimplemented (sin Playwright inyectado). Use --mock para preview offline o inyecte adapter en host.",
    );
  }
  const preview = await previewRiporMutation({
    adapter: has("--mock") || process.env.LINKY_RIPOR_MODE === "mock" ? createMockRiporUiAdapter() : adapter,
    profile,
    op,
    dateYmd: payload.dateYmd,
    draft: payload.draft,
    reportId: payload.reportId ?? arg("--id"),
    activitiesCoverFullDay: payload.activitiesCoverFullDay,
    sustainedActivityHours: payload.sustainedActivityHours,
    coverageProof: payload.coverageProof,
  });
  const out = arg("--out") ?? path.join(linkyDataDir(dataDir()), "last-ripor-preview.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(preview, null, 2));
  console.log(
    JSON.stringify(
      {
        out,
        snapshotHash: preview.snapshotHash,
        op: preview.op,
        blockers: preview.blockers,
        proposedTotalHours: preview.proposedTotalHours,
        expectedHoursForDay: preview.expectedHoursForDay,
        publicUrl: preview.publicUrl,
        adapterKind: has("--mock") ? "mock" : adapter.kind,
      },
      null,
      2,
    ),
  );
}

async function cmdRiporApply() {
  if (!has("--approve")) throw new Error("Ripor apply requiere --approve.");
  const by = arg("--by");
  if (!by) throw new Error("Falta --by <quien-aprueba>");
  const previewFile = arg("--preview");
  if (!previewFile) throw new Error("Falta --preview <json>");
  const preview = await readJson<Awaited<ReturnType<typeof previewRiporMutation>>>(previewFile);
  const hash = arg("--snapshot") ?? preview.snapshotHash;
  if (!hash) throw new Error("Falta snapshotHash.");
  const profile = await loadRiporProfile(dataDir());
  if (!profile?.setupComplete) throw new Error("Falta ripor setup.");

  const approval: RiporApproval = {
    op: preview.op,
    dateYmd: preview.dateYmd,
    snapshotHash: hash,
    reportId: preview.reportId,
    deleteConfirmed: has("--delete-confirmed"),
  };

  const useMock = has("--mock") || process.env.LINKY_RIPOR_MODE === "mock";
  if (!useMock) {
    throw new Error(
      "Apply Ripor real requiere host con Playwright MCP inyectado. En CLI local use --mock (no publica a Ripor).",
    );
  }

  const existingSeed =
    preview.before && preview.reportId
      ? {
          [preview.dateYmd]: [
            {
              id: preview.reportId,
              hours: preview.before.hours,
              summary: preview.before.description,
            },
          ],
        }
      : undefined;
  const adapter = createMockRiporUiAdapter({ existing: existingSeed });

  const coverageProof = preview.coverageProof;
  const result = await applyRiporMutation({
    adapter,
    profile,
    op: preview.op,
    dateYmd: preview.dateYmd,
    draft: preview.fields,
    reportId: preview.reportId,
    approval,
    activitiesCoverFullDay: preview.activitiesCoverFullDay,
    sustainedActivityHours: coverageProof?.sustainedActivityHours,
    coverageProof,
    dataDir: dataDir(),
    dryRun: has("--dry-run"),
  });
  console.log(JSON.stringify({ approvedBy: by, mock: true, result }, null, 2));
  if (!result.ok) process.exit(1);
}

async function cmdRiporDeletePreview() {
  const dateYmd = arg("--date");
  const id = arg("--id");
  if (!dateYmd || !id) throw new Error("Delete preview requiere --date YYYY-MM-DD y --id <reportId>");
  const profile = await loadRiporProfile(dataDir());
  if (!profile?.setupComplete) throw new Error("Falta ripor setup.");
  const useMock = has("--mock") || process.env.LINKY_RIPOR_MODE === "mock";
  if (!useMock) {
    throw new Error("Use --mock en CLI local, o host Playwright. No delete real desde este stub.");
  }
  const adapter = createMockRiporUiAdapter({
    existing: { [dateYmd]: [{ id, hours: Number(arg("--hours") ?? 8.5) }] },
  });
  const preview = await previewRiporMutation({
    adapter,
    profile,
    op: "delete",
    dateYmd,
    reportId: id,
  });
  const out = arg("--out") ?? path.join(linkyDataDir(dataDir()), "last-ripor-delete-preview.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(preview, null, 2));
  console.log(
    JSON.stringify(
      {
        out,
        snapshotHash: preview.snapshotHash,
        note: "Apply delete requiere --approve --delete-confirmed --by …",
        blockers: preview.blockers,
      },
      null,
      2,
    ),
  );
}

async function cmdRiporUiCheck(gate: boolean) {
  const file = arg("--input");
  if (!file) throw new Error("ripor check/gate requires --input <local-UI-observation.json>; never mock or cookies.");
  const input = await readJson<UiCheckInput>(file);
  const profile = await loadRiporProfile(dataDir());
  if (!profile) throw new Error("Ripor setup required.");
  if (gate) {
    const snapshotHash = arg("--snapshot");
    if (!has("--approve") || !arg("--by") || !snapshotHash) throw new Error("gate requires --approve --by --snapshot (specific user approval required)");
    const result = gateObservedRipor(input, profile, {
      op: input.op, dateYmd: input.dateYmd, reportId: input.reportId, snapshotHash,
      deleteConfirmed: has("--delete-confirmed"),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const preview = checkObservedRipor(input, profile);
  const out = path.join(linkyDataDir(dataDir()), "last-ripor-ui-preview.json");
  await writeFile(out, JSON.stringify(preview, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ out, ...preview }, null, 2));
  if (preview.blockers.length) process.exitCode = 1;
}

async function cmdRiporStatus() {
  const profile = await loadOrEmptyRiporProfile(dataDir());
  const journal = await loadRiporJournal(dataDir());
  const block = riporJournalBlocksMutations(journal);
  console.log(
    JSON.stringify(
      {
        publicUrl: RIPOR_PUBLIC_URL,
        setupComplete: profile.setupComplete,
        areaProject: profile.areaProject ?? null,
        defaultTaskLabel: profile.defaultTaskLabel,
        defaultTransport: profile.defaultTransport ?? null,
        azureProjectHints: profile.azureProjectHints,
        schedule: profile.schedule,
        browserProfileDir: riporBrowserProfileDir(dataDir()),
        capabilities: defaultBrowserCapabilities(),
        journalOpen: block,
        journalEntries: journal.length,
        adapterNote:
          "CLI sin Playwright inyectado: use --mock. Navegación real a cargo del host/parent.",
      },
      null,
      2,
    ),
  );
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "onboarding":
      await cmdOnboarding();
      break;
    case "plan":
      await cmdPlan();
      break;
    case "preview":
      await cmdPreview();
      break;
    case "apply":
      await cmdApply();
      break;
    case "reconcile":
      await cmdReconcile();
      break;
    case "drafts":
      await cmdDrafts();
      break;
    case "status":
      await cmdStatus();
      break;
    case "browser": {
      const sub = process.argv[3];
      if (sub === "setup") console.log(JSON.stringify(await writeBrowserSetup(dataDir()), null, 2));
      else if (sub === "status") console.log(JSON.stringify(await browserSetupStatus(dataDir()), null, 2));
      else throw new Error("browser setup|status: generate local MCP config only, no automatic installation/connection");
      break;
    }
    case "ripor": {
      const sub = process.argv[3];
      if (sub === "setup") await cmdRiporSetup();
      else if (sub === "preview") await cmdRiporPreview();
      else if (sub === "apply") await cmdRiporApply();
      else if (sub === "delete-preview") await cmdRiporDeletePreview();
      else if (sub === "status") await cmdRiporStatus();
      else if (sub === "check") await cmdRiporUiCheck(false);
      else if (sub === "gate") await cmdRiporUiCheck(true);
      else {
        console.log(`linky ripor <setup|preview|apply|delete-preview|status|check|gate>
URL: ${RIPOR_PUBLIC_URL}
Solo UI; --mock offline. Apply real requiere Playwright del host. No cookies/API internas.`);
        process.exit(sub ? 1 : 0);
      }
      break;
    }
    default:
      console.log(`Linky CLI
Comandos: onboarding | plan | preview | apply | reconcile | drafts | status | ripor | browser
Flags: --data-dir --mock --secret-backend env|session --approve --by --snapshot --key
Ripor: ripor setup|preview|apply|delete-preview|status (URL https://ripor.co/u/horas)
PAT: keyring OS; alternativa explícita env/session. Nunca archivo plaintext.
Expiry/scopes: user-reported (no se leen del string PAT). Recordatorio OS solo opt-in.
Scheduling no se activa al instalar.`);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(String((e as Error).message || e));
  process.exit(1);
});
