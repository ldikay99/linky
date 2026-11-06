/** PRs de Azure Repos creados o cerrados por la persona en un día (evidencia de desarrollo). */
import { azureReadJson } from "../azure/http.js";
import { azureAuthHeaders, type AzureAuth } from "../azure/client.js";
import { zonedToUtc } from "../calendar/ics.js";

export type PullRequestItem = { id: number; title: string; status: string; repo: string; project: string; url: string; event: "creado" | "cerrado" };

/** Proyectos de Azure de una organización a partir de las URLs web de los repos locales. */
export function azureProjectsFromBases(bases: string[], organizationUrl: string): string[] {
  const org = new URL(organizationUrl).pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  const out = new Set<string>();
  for (const b of bases) {
    const m = /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//.exec(b);
    if (m && m[1].toLowerCase() === org) out.add(decodeURIComponent(m[2]));
  }
  return [...out];
}

export async function azurePullRequestsOn(input: {
  organizationUrl: string;
  auth: Pick<AzureAuth, "pat" | "cookie">;
  projects: string[];
  dateYmd: string;
  timeZone: string;
  fetchImpl?: typeof fetch;
}): Promise<PullRequestItem[]> {
  const doFetch = input.fetchImpl ?? fetch;
  const headers = { ...azureAuthHeaders(input.auth), accept: "application/json" };
  const org = input.organizationUrl;
  const me = await azureReadJson<{ authenticatedUser: { id: string } }>(doFetch, `${org}/_apis/connectionData`, headers);
  const [y, m, d] = input.dateYmd.split("-").map(Number);
  const start = zonedToUtc(y, m, d, 0, 0, 0, input.timeZone);
  const end = start + 86_400_000;
  const inDay = (iso?: string) => Boolean(iso) && Date.parse(iso!) >= start && Date.parse(iso!) < end;
  const out: PullRequestItem[] = [];
  for (const project of input.projects) {
    const p = encodeURIComponent(project);
    const data = await azureReadJson<{
      value: Array<{ pullRequestId: number; title: string; status: string; creationDate?: string; closedDate?: string; repository: { name: string } }>;
    }>(
      doFetch,
      `${org}/${p}/_apis/git/pullrequests?searchCriteria.creatorId=${me.authenticatedUser.id}&searchCriteria.status=all&$top=200&api-version=7.1`,
      headers,
    );
    for (const pr of data.value) {
      const event = inDay(pr.closedDate) ? "cerrado" : inDay(pr.creationDate) ? "creado" : undefined;
      if (!event) continue;
      out.push({
        id: pr.pullRequestId,
        title: pr.title,
        status: pr.status,
        repo: pr.repository.name,
        project,
        url: `${org}/${p}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
        event,
      });
    }
  }
  return out;
}
