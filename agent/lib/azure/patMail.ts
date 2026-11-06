/**
 * Vencimiento del PAT sin preguntar: Azure DevOps envía un correo al crear un token
 * ("personal access token added") y otro 7 días antes de que venza ("nearing expiration"),
 * con "Expiring on <m/d/yyyy>" y "Organization <nombre>". Linky los lee del Gmail de la persona.
 */
import { gmailTitleYmd } from "../mail/gmail.js";

export type PatMail = { kind: "added" | "nearing"; organization: string; expiresOn: string; receivedOn?: string };

/** Fecha del correo de Azure: plantilla en inglés = mes/día/año. */
export function parseAzureMailDate(s: string): string | undefined {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (!m) return undefined;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parsePatMail(subject: string, body: string, receivedTitle?: string): PatMail | undefined {
  const kind = /nearing expiration|por vencer|próximo a vencer/i.test(subject) ? "nearing" : /token added|agregado|añadido/i.test(subject) ? "added" : undefined;
  if (!kind) return undefined;
  // Solo las líneas de la tabla del correo (la prosa también dice "organization" / "expiring on").
  const exp = /^\s*(?:Expiring on|Expira el|Vence el)\s*:?\s*([\d/]+)/im.exec(body)?.[1];
  const org = /^\s*(?:Organization|Organización)\s*:?[ \t]*([^\s]+)/im.exec(body)?.[1];
  const expiresOn = exp ? parseAzureMailDate(exp) : undefined;
  if (!expiresOn || !org) return undefined;
  return { kind, organization: org, expiresOn, receivedOn: receivedTitle ? gmailTitleYmd(receivedTitle) : undefined };
}

/**
 * Vencimiento por organización: el del token creado más recientemente (el que la persona acaba de conectar).
 * Devuelve también los avisos "nearing" para mostrarlos tal cual.
 */
export function patExpiriesByOrg(mails: PatMail[]): { latestAdded: Map<string, PatMail>; nearing: PatMail[] } {
  const latestAdded = new Map<string, PatMail>();
  for (const m of mails.filter((x) => x.kind === "added")) {
    const key = m.organization.toLowerCase();
    const prev = latestAdded.get(key);
    if (!prev || (m.receivedOn ?? "") > (prev.receivedOn ?? "") || ((m.receivedOn ?? "") === (prev.receivedOn ?? "") && m.expiresOn > prev.expiresOn)) {
      latestAdded.set(key, m);
    }
  }
  return { latestAdded, nearing: mails.filter((x) => x.kind === "nearing") };
}
