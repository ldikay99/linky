import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, symlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { browserSetupPlan, browserSetupStatus, writeBrowserSetup } from "../agent/lib/browser/setup.js";
import { linkyDataDir } from "../agent/lib/security/paths.js";
import { riporBrowserProfileDir } from "../agent/lib/browser/paths.js";
import { createPlaywrightMcpRiporAdapter, observeLoginStatus, type PublicMcpClient } from "../agent/lib/browser/mcpAdapter.js";
import { previewRiporMutation } from "../agent/lib/ripor/apply.js";
import { RIPOR_UI_OBSERVATIONS } from "../agent/lib/ripor/uiObservations.js";
import { checkObservedRipor, gateObservedRipor, type UiCheckInput } from "../agent/lib/ripor/uiCheck.js";
import { emptyRiporProfile } from "../agent/lib/ripor/setup.js";

const URL = "https://ripor.co/u/horas";
const PAGE = `- Page URL: ${URL}
\`\`\`yaml
- heading "Horas de actividad" [level=1] [ref=e1]
- button "Registrar" [ref=e2]
- combobox "Seleccionar medio de transporte" [ref=e3]
\`\`\``;

function fakeClient(snapshots: string[], targetKey = "target") {
  let count = 0;
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const client: PublicMcpClient = {
    async listTools() { return { tools: [
      { name: "browser_snapshot", inputSchema: { properties: {} } },
      { name: "browser_navigate", inputSchema: { properties: { url: {} } } },
      { name: "browser_click", inputSchema: { properties: { [targetKey]: {}, element: {} } } },
      // Even if the server exposes unsafe tools, adapter cannot call them.
      { name: "browser_run_code_unsafe", inputSchema: { properties: { code: {} } } },
    ] }; },
    async callTool(request) {
      calls.push(request);
      const text = request.name === "browser_snapshot" ? snapshots[Math.min(count++, snapshots.length - 1)]! : "done";
      return { content: [{ type: "text", text }] };
    },
  };
  return { client, calls };
}

describe("portable browser setup (offline only)", () => {
  it("generates private standard stdio configs without installation, client edits, or browser startup", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "linky-browser-"));
    const plan = await writeBrowserSetup(dir);
    expect(plan.installed).toBe(false);
    expect(plan.connected).toBe(false);
    expect(plan.generatedFiles).toHaveLength(4);
    const config = JSON.parse(await readFile(path.join(plan.dir, "mcp.generic.json"), "utf8"));
    expect(config.mcpServers["linky-ripor"].command).toBe("npx");
    const runtime = JSON.parse(await readFile(path.join(plan.dir, "playwright-headed.json"), "utf8"));
    expect(runtime.browser.userDataDir).toBe(riporBrowserProfileDir(dir));
    expect(runtime.browser.launchOptions.headless).toBe(false);
    expect(runtime.saveSession).toBe(false);
    expect(runtime.capabilities).toEqual(["core"]);
    expect(runtime.webmcp).toBe(false);
    const hidden = JSON.parse(await readFile(path.join(plan.dir, "playwright-headless.json"), "utf8"));
    expect(hidden.browser.userDataDir).toBe(runtime.browser.userDataDir);
    expect(hidden.browser.launchOptions.headless).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/storage-state|cdp-endpoint|--extension|--port|--no-sandbox/);
    expect((await browserSetupStatus(dir)).runtimeVerified).toBe(false);
    await expect(writeBrowserSetup(dir)).rejects.toThrow(/already exists/);
  });

  it("canonicalizes symlink ancestors and rejects repo aliases even with a different cwd", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "linky-path-"));
    const repo = process.cwd();
    await symlink(repo, path.join(outside, "alias"), "dir");
    const prev = process.cwd();
    try {
      process.chdir(outside);
      expect(() => linkyDataDir(path.join(outside, "alias", "new-profile"))).toThrow(/rechazado/);
    } finally { process.chdir(prev); }
    await mkdir(path.join(outside, "browser-profiles"));
    await symlink(repo, path.join(outside, "browser-profiles", "ripor"), "dir");
    expect(() => browserSetupPlan(outside)).toThrow(/rechazado/);
  });
});

describe("public MCP UI adapter (unit simulations, not live)", () => {
  it("opens only official URL via documented tool and derives positive UI login markers", async () => {
    const { client, calls } = fakeClient([PAGE]);
    const adapter = createPlaywrightMcpRiporAdapter(client);
    expect(await adapter.openPublicPage()).toEqual({ status: "authenticated" });
    expect(calls).toEqual([
      { name: "browser_navigate", arguments: { url: URL } },
      { name: "browser_snapshot", arguments: {} },
    ]);
    expect(observeLoginStatus(`- Page URL: ${URL}`)).toBe("unknown");
    expect(observeLoginStatus('- button "Iniciar sesión" [ref=e1]')).toBe("needs_login");
    expect(observeLoginStatus(PAGE.replace(URL, "https://example.com"))).toBe("unknown");
    expect(adapter.capabilities.headlessReuseSupported).toBe(false);
  });

  it.each(["target", "ref"])("discovers %s schema; fresh dropdown ref only; reads visible options", async key => {
    const { client, calls } = fakeClient([PAGE, PAGE + '\n- listbox [ref=e9]:\n  - option "🏠 Trabajo Remoto" [ref=e10]'], key);
    const adapter = createPlaywrightMcpRiporAdapter(client);
    expect(await adapter.listTransportLabels()).toEqual(["🏠 Trabajo Remoto"]);
    expect(calls.map(c => c.name)).toEqual(["browser_snapshot", "browser_click", "browser_snapshot"]);
    expect(calls[1]!.arguments[key]).toBe("e3");
    expect(calls.every(c => !/unsafe|evaluate|network|storage|cookie/.test(c.name))).toBe(true);
  });

  it("ambiguous project labels or duplicate combos cause no click and no manufactured options", async () => {
    const { client, calls } = fakeClient([PAGE + '\n- combobox "Insertar" [ref=e7]']);
    const adapter = createPlaywrightMcpRiporAdapter(client);
    await expect(adapter.listAreaProjects()).rejects.toThrow(/Ambiguous/);
    expect(calls.map(c => c.name)).toEqual(["browser_snapshot"]);
  });

  it("does not invent an empty day, does not submit Continuar, and blocks real preview", async () => {
    const { client, calls } = fakeClient([PAGE]);
    const adapter = createPlaywrightMcpRiporAdapter(client);
    await expect(adapter.applyUiAction({ op: "update", dateYmd: "2026-11-05" })).rejects.toThrow(/LIVE_MUTATION_UNVERIFIED/);
    const preview = await previewRiporMutation({
      adapter, profile: emptyRiporProfile(), op: "create", dateYmd: "2026-11-05",
      draft: {
        dateYmd: "2026-11-05", areaProjectLabel: "Synthetic Area", taskLabel: "Tarea Personalizada",
        hours: 8.5, description: "Synthetic confirmed work on Azure tasks for this day.", evidenceUrls: ["https://example.com/work"],
        transportLabel: "🏠 Trabajo Remoto", transportIsDailyOverride: false,
      },
      coverageProof: { sustainedActivityHours: 8.5, source: "azure_confirmed", coversDraftDedication: true },
    });
    expect(preview.blockers.some(b => /unknown|observation failed/i.test(b))).toBe(true);
    expect(calls).toEqual([]);
  });

  it("tool error has no data leak and no fallback to run_code/network", async () => {
    const { client, calls } = fakeClient([PAGE]);
    client.callTool = async request => {
      calls.push(request);
      return { isError: true, content: [{ type: "text", text: "private-data-should-not-leak" }] };
    };
    const adapter = createPlaywrightMcpRiporAdapter(client);
    await expect(adapter.observeForm()).rejects.toThrow(/^MCP browser_snapshot failed;/);
    expect(calls.map(c => c.name)).toEqual(["browser_snapshot"]);
  });
});


describe("real-observation deterministic gates (no mock or browser needed)", () => {
  function input(): UiCheckInput {
    return {
      op: "update", dateYmd: "2026-11-05", reportId: "synthetic-row",
      draft: {
        dateYmd: "2026-11-05", areaProjectLabel: "Synthetic Area", taskLabel: "Tarea Personalizada",
        hours: 8.5, description: "Synthetic confirmed activities on Azure tasks for this day.", evidenceUrls: ["https://example.com/work"],
        transportLabel: "🏠 Trabajo Remoto", transportIsDailyOverride: false,
      },
      coverageProof: { sustainedActivityHours: 8.5, coversDraftDedication: true, source: "azure_confirmed" },
      observation: {
        source: "ui_snapshot", dateYmd: "2026-11-05", complete: true,
        reports: [{ id: "synthetic-row", dateYmd: "2026-11-05", hours: 8.5, description: "Before" }],
        areaProjects: ["Synthetic Area"], tasks: ["Tarea Personalizada"], transports: ["🏠 Trabajo Remoto"],
      },
    };
  }
  const profile = { ...emptyRiporProfile(), setupComplete: true };
  it("shows before/after and validates specific hash without performing mutation", () => {
    const i = input();
    const preview = checkObservedRipor(i, profile);
    expect(preview.blockers).toEqual([]);
    expect(preview.before?.description).toBe("Before");
    expect(preview.after?.description).toBe(i.draft!.description);
    const decision = gateObservedRipor(i, profile, {
      op: i.op, dateYmd: i.dateYmd, reportId: i.reportId, snapshotHash: preview.snapshotHash,
    });
    expect(decision.ok).toBe(true);
    expect(decision.mutationPerformed).toBe(false);
  });
  it("incomplete observation, missing option, new existing row all block approved gate", () => {
    const i = input();
    const hash = checkObservedRipor(i, profile).snapshotHash;
    i.observation.complete = false;
    i.observation.tasks = [];
    i.observation.reports.push({ id: "other-row", dateYmd: i.dateYmd, hours: 1 });
    const decision = gateObservedRipor(i, profile, {
      op: i.op, dateYmd: i.dateYmd, reportId: i.reportId, snapshotHash: hash,
    });
    expect(decision.ok).toBe(false);
    expect(decision.preview.blockers.some(b => /Complete dated UI/.test(b))).toBe(true);
    expect(decision.preview.blockers.some(b => /Task not observed/.test(b))).toBe(true);
    expect(decision.preview.blockers.some(b => /Excede/.test(b))).toBe(true);
    expect(decision.errors.some(e => /snapshotHash/.test(e))).toBe(true);
  });
});


it("distinguishes verified manual UI cycle from unsupported automated mutations", () => {
  expect(RIPOR_UI_OBSERVATIONS.session.manualCreateDeleteObserved).toBe(true);
  expect(RIPOR_UI_OBSERVATIONS.session.automaticSelectorsStable).toBe(false);
  expect(RIPOR_UI_OBSERVATIONS.createObservation.continueSavesDirectly).toBe(true);
  expect(RIPOR_UI_OBSERVATIONS.createObservation.hoursAppearAfterTaskCheckbox).toBe("Tarea Personalizada");
  expect(RIPOR_UI_OBSERVATIONS.deleteObservation.confirmButton).toBe("Continuar");
  expect(RIPOR_UI_OBSERVATIONS.deleteObservation.approvalBeforeConfirmationClick).toBe(true);
  expect(RIPOR_UI_OBSERVATIONS.session.headlessReuseValidated).toBe(false);
  expect(RIPOR_UI_OBSERVATIONS.createObservation.evidenceMultipleUrlsVerified).toBe(false);
});
