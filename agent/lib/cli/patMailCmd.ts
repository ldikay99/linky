/**
 * Vencimiento de PATs leído de los correos de Azure DevOps (sin preguntar a la persona).
 */
import { loadAzureOrgs, orgKey, registerAzureOrg } from "../azure/orgs.js";
import { parsePatMail, patExpiriesByOrg, type PatMail } from "../azure/patMail.js";
import { gmailSearchMessages } from "../mail/gmail.js";
import { loadProfile, saveProfile } from "../profile/store.js";

export async function readPatMails(dataDir?: string, opts?: { days?: number; max?: number }): Promise<PatMail[]> {
  const msgs = await gmailSearchMessages({
    query: `from:azuredevops@microsoft.com "personal access token" newer_than:${opts?.days ?? 200}d`,
    max: opts?.max ?? 15,
    dataDir,
  });
  return msgs.map((m) => parsePatMail(m.subject, m.body, m.received)).filter((m): m is PatMail => Boolean(m));
}

/** Registra el vencimiento (token más reciente por organización) en las organizaciones conectadas. */
export async function applyPatExpiriesFromMail(dataDir?: string, onlyOrg?: string, opts?: { days?: number; max?: number }) {
  const mails = await readPatMails(dataDir, opts);
  const { latestAdded, nearing } = patExpiriesByOrg(mails);
  const reg = await loadAzureOrgs(dataDir);
  const updated: Array<{ organizacion: string; vence: string; fuente: string }> = [];
  for (const o of reg.orgs) {
    if (onlyOrg && orgKey(o.organizationUrl) !== orgKey(onlyOrg)) continue;
    const mail = latestAdded.get(orgKey(o.organizationUrl));
    if (!mail || mail.expiresOn === o.expiresOn) continue;
    await registerAzureOrg({ ...o, expiresOn: mail.expiresOn }, { primary: reg.primary === o.organizationUrl, dataDir });
    updated.push({ organizacion: o.organizationUrl, vence: mail.expiresOn, fuente: `correo de Azure del ${mail.receivedOn ?? "?"}` });
    // El perfil de trabajo (organización principal) guarda el mismo dato para sus recordatorios.
    if (reg.primary === o.organizationUrl) {
      const profile = await loadProfile(dataDir);
      if (profile?.patLifecycle && profile.patLifecycle.expiresOn !== mail.expiresOn) {
        await saveProfile({ ...profile, patLifecycle: { ...profile.patLifecycle, expiresOn: mail.expiresOn } }, dataDir);
      }
    }
  }
  const sinCorreo = reg.orgs.filter((o) => !latestAdded.has(orgKey(o.organizationUrl))).map((o) => o.organizationUrl);
  return { actualizados: updated, sinCorreo, avisosDeAzure: nearing };
}
