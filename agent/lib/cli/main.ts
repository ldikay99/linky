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
import type { ApplyPreview } from "../types.js";

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
    default:
      console.log(`Linky CLI
Comandos: onboarding | plan | preview | apply | reconcile | drafts | status
Flags: --data-dir --mock --secret-backend env|session --approve --by --snapshot --key
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
