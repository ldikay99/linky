import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAzureOrgs, registerAzureOrg, unregisterAzureOrg } from "../agent/lib/azure/orgs.js";

describe("registro de organizaciones Azure", () => {
  it("desvincular quita la organización y pasa la principal a la siguiente", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "linky-orgs-"));
    await registerAzureOrg({ organizationUrl: "https://dev.azure.com/Uno", auth: "pat" }, { primary: true, dataDir: dir });
    await registerAzureOrg({ organizationUrl: "https://dev.azure.com/Dos", auth: "pat" }, { dataDir: dir });
    const after = await unregisterAzureOrg("https://dev.azure.com/uno", dir);
    expect(after.orgs.map((o) => o.organizationUrl)).toEqual(["https://dev.azure.com/Dos"]);
    expect(after.primary).toBe("https://dev.azure.com/Dos");
    const empty = await unregisterAzureOrg("https://dev.azure.com/Dos", dir);
    expect(empty).toEqual({ primary: undefined, orgs: [] });
    expect((await loadAzureOrgs(dir)).orgs).toEqual([]);
  });
});
