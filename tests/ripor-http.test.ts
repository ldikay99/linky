import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyRiporMutation, previewRiporMutation } from "../agent/lib/ripor/apply.js";
import { buildRiporProfileFromSetup } from "../agent/lib/ripor/setup.js";
import { loadRiporJournal, riporJournalBlocksMutations } from "../agent/lib/ripor/journal.js";
import type { RiporDraftFields, RiporProfile } from "../agent/lib/ripor/types.js";
import { createFakeSecretStore } from "../agent/lib/security/secretStore.js";
import {
  applySetCookie,
  createHttpRiporAdapter,
  createRiporHttpClient,
  decodeSvelteKitData,
  describeRiporSession,
  extractAuthCookiesFromPaste,
  loadRiporSession,
  openRiporHttp,
  RiporSessionExpiredError,
  saveRiporSession,
  unflatten,
} from "../agent/lib/ripor/http/index.js";

// Nombre de cookie armado por partes para no parecer un secreto real en el repo.
const AUTH = "sb-" + "demoref" + "-auth-token";
const DATE = "2026-11-04"; // miércoles → 8.5 h
const USER_ID = 77;

function syntheticAuthValue(expiresAtSec: number): string {
  const json = JSON.stringify({ access_token: "synthetic", refresh_token: "synthetic-r", expires_at: expiresAtSec, user: { email: "persona@example.com" } });
  return "base64-" + Buffer.from(json).toString("base64url");
}

function profile(): RiporProfile {
  const r = buildRiporProfileFromSetup({
    uiObserved: true,
    uiAreaProjects: [{ label: "900 - AREA DEMO", projectId: 9001, analyticAccountId: 9002, code: "0009000", verifiedFromUi: true }],
    chosenAreaProjectLabel: "900 - AREA DEMO",
    uiTaskOptions: [{ label: "Tarea Personalizada", uiValue: "42", verifiedFromUi: true }],
    chosenTaskLabel: "Tarea Personalizada",
    uiTransportOptions: [
      { label: "🏠 Trabajo Remoto", formValue: "trabajo_remoto", verifiedFromUi: true },
      { label: "Bicicleta", formValue: "bicicleta", verifiedFromUi: false },
    ],
    chosenTransportLabel: "🏠 Trabajo Remoto",
  });
  if (!r.profile) throw new Error(r.errors.join(";"));
  return r.profile;
}

function draft(over: Partial<RiporDraftFields> = {}): RiporDraftFields {
  return {
    dateYmd: DATE,
    areaProjectLabel: "900 - AREA DEMO",
    taskLabel: "Tarea Personalizada",
    hours: 8.5,
    description: "Avance sintético en tareas Azure del día: ajustes y pruebas.",
    evidenceUrls: ["https://dev.azure.com/ExampleOrg/Example/_workitems/edit/1"],
    transportLabel: "🏠 Trabajo Remoto",
    transportIsDailyOverride: false,
    ...over,
  };
}

const proof = { sustainedActivityHours: 8.5, coversDraftDedication: true as const, source: "azure_confirmed" as const };

type Posted = { action: string; form: URLSearchParams };

/** Servidor Ripor falso: misma forma de rutas/respuestas que la web (SvelteKit). */
function fakeRipor(opts: { failPostWithNetwork?: boolean; setCookieOnce?: string } = {}) {
  const reports: Array<Record<string, unknown>> = [];
  const posted: Posted[] = [];
  let nextId = 5000;
  let setCookie = opts.setCookieOnce;

  const raw = (id: number, date: string, hours: number, notes: string, evidencia: string, transport: string) => ({
    hr_contractor_reported_hours: { id, date, hours, user_id: USER_ID, report_task_id: 42, report_description: notes, evidencia },
    account_analytic_line: { id, date, unit_amount: hours, user_id: USER_ID, project_id: 9001, account_id: 9002, report_description: notes },
    linktic_report_task: { id: 42, name: "Tarea Personalizada", task_group_id: 1 },
    account_analytic_account: { id: 9002, code: "0009000", name: "900 - AREA DEMO" },
    project_id: 9001,
    id,
    evidencia,
    medio_transporte: transport,
  });

  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => {
    const headers = new Headers({ "content-type": "application/json", ...extra });
    return new Response(JSON.stringify(body), { status, headers });
  };

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (!(headers.get("cookie") ?? "").includes(AUTH)) {
      return new Response(null, { status: 303, headers: { location: "/login" } });
    }
    const extra: Record<string, string> = {};
    if (setCookie) {
      extra["set-cookie"] = setCookie;
      setCookie = undefined;
    }
    if (url.pathname === "/u/horas/getReport") {
      const d = url.searchParams.get("date");
      return json({ success: true, result: reports.filter((r) => (r.hr_contractor_reported_hours as { date: string }).date === d) }, 200, extra);
    }
    if (url.pathname === "/u/horas/__data.json") {
      const data = [{ reports: 1, totalhoursPerUser: 4 }, [2], { date: 3 }, "2026-11-03", 180];
      return json({ type: "data", nodes: [null, { type: "data", data }] }, 200, extra);
    }
    if (url.pathname === "/u/horas" && init?.method === "POST") {
      if (opts.failPostWithNetwork) throw new Error("fetch failed: ECONNRESET");
      const action = url.search.replace("?/", "");
      const form = new URLSearchParams(String(init.body));
      posted.push({ action, form });
      if (headers.get("x-sveltekit-action") !== "true") return json({ type: "error", status: 400 });
      if (action === "create") {
        const id = nextId++;
        reports.push(raw(id, form.get("date")!, Number(form.get("hours")), form.get("notes")!, form.get("evidencia")!, form.get("medio_transporte")!));
      } else if (action === "update") {
        const r = reports.find((x) => x.id === Number(form.get("id")));
        if (!r) return json({ type: "failure", status: 404, data: JSON.stringify([{ message: 1 }, "no existe"]) });
        // Como Ripor real: la evidencia se toma del objeto `report` enviado, no del campo suelto.
        const sent = JSON.parse(form.get("report")!) as { evidencia: string };
        Object.assign(r, raw(Number(form.get("id")), form.get("date")!, Number(form.get("hours")), form.get("notes")!, sent.evidencia, form.get("medio_transporte")!));
      } else if (action === "delete") {
        if (Number(form.get("personal_id")) !== USER_ID) return json({ type: "failure", status: 403, data: JSON.stringify([{ message: 1 }, "no autorizado"]) });
        const i = reports.findIndex((x) => x.id === Number(form.get("id")));
        if (i >= 0) reports.splice(i, 1);
      }
      return json({ type: "success", status: 200, data: JSON.stringify([{ success: 1 }, true]) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return { fetchImpl, reports, posted };
}

function sessionHandle(cookies: Record<string, string>) {
  const refreshed: Array<Record<string, string>> = [];
  let jar = cookies;
  return {
    refreshed,
    handle: {
      cookies: () => jar,
      async onRefresh(next: Record<string, string>) {
        jar = next;
        refreshed.push(next);
      },
    },
  };
}

async function setup(opts?: Parameters<typeof fakeRipor>[0]) {
  const server = fakeRipor(opts);
  const s = sessionHandle({ [`${AUTH}.0`]: syntheticAuthValue(4_000_000_000) });
  const client = createRiporHttpClient(s.handle, server.fetchImpl);
  const p = profile();
  const adapter = createHttpRiporAdapter({ client, profile: p });
  const dataDir = await mkdtemp(path.join(tmpdir(), "linky-ripor-http-"));
  return { server, client, adapter, profile: p, dataDir, session: s };
}

async function approveAndApply(ctx: Awaited<ReturnType<typeof setup>>, op: "create" | "update" | "delete", d?: RiporDraftFields, reportId?: string) {
  const preview = await previewRiporMutation({ adapter: ctx.adapter, profile: ctx.profile, op, dateYmd: DATE, draft: d, reportId, coverageProof: d ? proof : undefined });
  return applyRiporMutation({
    adapter: ctx.adapter,
    profile: ctx.profile,
    op,
    dateYmd: DATE,
    draft: d,
    reportId,
    coverageProof: d ? proof : undefined,
    approval: { op, dateYmd: DATE, snapshotHash: preview.snapshotHash, reportId, deleteConfirmed: op === "delete" },
    dataDir: ctx.dataDir,
  });
}

describe("devalue / __data.json", () => {
  it("decodifica referencias, especiales y nodos", () => {
    expect(unflatten([{ a: 1, b: 2, c: -1 }, "x", [3, 3], 5])).toEqual({ a: "x", b: [5, 5], c: undefined });
    const nodes = decodeSvelteKitData(JSON.stringify({ type: "data", nodes: [null, { type: "data", data: [{ k: 1 }, ["Date", "2026-11-04T00:00:00.000Z"]] }] }));
    expect(nodes[0]).toBeNull();
    expect((nodes[1] as { k: Date }).k).toBeInstanceOf(Date);
  });
});

describe("sesión Ripor", () => {
  it("extrae SOLO cookies de auth desde 'Copiar como cURL (cmd)' y header crudo", () => {
    const cmdCurl = `curl ^"https://ripor.co/u/horas^" -b ^"_ga=GA1.1; ${AUTH}.0=base64-abc^%^3D; ${AUTH}.1=def; _clsk=x^"`;
    expect(extractAuthCookiesFromPaste(cmdCurl)).toEqual({ [`${AUTH}.0`]: "base64-abc%3D", [`${AUTH}.1`]: "def" });
    expect(extractAuthCookiesFromPaste(`cookie: _ga=1; ${AUTH}=v`)).toEqual({ [AUTH]: "v" });
    expect(() => extractAuthCookiesFromPaste("_ga=1; _clck=2")).toThrow(/No se encontraron/);
  });

  it("aplica Set-Cookie de refresh y borrados", () => {
    const jar: Record<string, string> = { [`${AUTH}.0`]: "old", [`${AUTH}.1`]: "tail" };
    expect(applySetCookie(jar, [`${AUTH}.0=new; Path=/; HttpOnly`, `${AUTH}.1=; Max-Age=0`])).toBe(true);
    expect(jar).toEqual({ [`${AUTH}.0`]: "new" });
  });

  it("guarda troceado en el almacén y limpia trozos sobrantes", async () => {
    const store = createFakeSecretStore();
    const big = "x".repeat(4500);
    await saveRiporSession({ cookies: { [`${AUTH}.0`]: big }, savedAt: "t", source: "paste" }, store);
    const keys = Object.keys(store.dump()).filter((k) => k.includes("session."));
    expect(keys.length).toBeGreaterThan(5);
    for (const v of Object.values(store.dump())) expect(v.length).toBeLessThanOrEqual(1000);
    expect((await loadRiporSession(store))?.cookies[`${AUTH}.0`]).toBe(big);

    await saveRiporSession({ cookies: { [`${AUTH}.0`]: "short" }, savedAt: "t2", source: "refresh" }, store);
    expect(Object.keys(store.dump()).filter((k) => /session\.\d/.test(k))).toHaveLength(1);
  });

  it("describe expiración sin exponer tokens", () => {
    const st = describeRiporSession({ cookies: { [`${AUTH}.0`]: syntheticAuthValue(1000) }, savedAt: "t", source: "browser" });
    expect(st).toMatchObject({ present: true, hasRefreshToken: true, accessTokenExpired: true, email: "persona@example.com" });
    expect(JSON.stringify(st)).not.toContain("synthetic");
  });
});

describe("adaptador HTTP + núcleo de políticas", () => {
  it("create envía el formulario de la web y verifica el reporte creado", async () => {
    const ctx = await setup();
    const r = await approveAndApply(ctx, "create", draft());
    expect(r.ok, r.errors.join(";")).toBe(true);
    expect(r.reportId).toBe("5000");
    const f = ctx.server.posted[0].form;
    expect(ctx.server.posted[0].action).toBe("create");
    expect(f.get("project_id")).toBe("9001");
    expect(f.get("analytic_account_id")).toBe("9002");
    expect(f.get("code")).toBe("0009000");
    expect(f.get("report_task_id")).toBe("42");
    expect(f.get("hours")).toBe("8.5");
    expect(f.get("currentMonth")).toBe('"2026-11"');
    expect(f.get("medio_transporte")).toBe("trabajo_remoto");
    expect(f.getAll("notes")).toHaveLength(2);
    expect((await loadRiporJournal(ctx.dataDir)).at(-1)?.status).toBe("ok");
  });

  it("segundo create el mismo día se bloquea (suma > 8.5) sin POST", async () => {
    const ctx = await setup();
    await approveAndApply(ctx, "create", draft());
    const r = await approveAndApply(ctx, "create", draft({ hours: 1, explicitUnderHoursRequest: { dateYmd: DATE, hours: 1 } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Excede máximo/);
    expect(ctx.server.posted).toHaveLength(1);
  });

  it("menos de la jornada sin petición explícita se bloquea", async () => {
    const ctx = await setup();
    const r = await approveAndApply(ctx, "create", draft({ hours: 4 }));
    expect(r.ok).toBe(false);
    expect(ctx.server.posted).toHaveLength(0);
  });

  it("update envía id, report original y reportDate; verifica cambios", async () => {
    const ctx = await setup();
    const c = await approveAndApply(ctx, "create", draft());
    const r = await approveAndApply(
      ctx,
      "update",
      draft({ description: "Descripción corregida con el resumen sintético de tareas Azure.", evidenceUrls: ["https://example.com/evidencia-nueva"] }),
      c.reportId,
    );
    expect(r.ok, r.errors.join(";")).toBe(true);
    const f = ctx.server.posted[1].form;
    expect(f.get("id")).toBe(c.reportId);
    expect(JSON.parse(f.get("report")!).id).toBe(5000);
    expect(JSON.parse(f.get("report")!).evidencia).toBe("https://example.com/evidencia-nueva");
    expect(ctx.server.reports[0].evidencia).toBe("https://example.com/evidencia-nueva");
    expect(JSON.parse(f.get("reportDate")!)).toHaveLength(1);
    expect(JSON.parse(f.get("reports")!)).toEqual([{ date: "2026-11-03" }]);
    expect(f.get("totalhoursPerUser")).toBe("180");
  });

  it("delete usa personal_id del reporte y requiere confirmación separada", async () => {
    const ctx = await setup();
    const c = await approveAndApply(ctx, "create", draft());
    const preview = await previewRiporMutation({ adapter: ctx.adapter, profile: ctx.profile, op: "delete", dateYmd: DATE, reportId: c.reportId });
    const denied = await applyRiporMutation({
      adapter: ctx.adapter, profile: ctx.profile, op: "delete", dateYmd: DATE, reportId: c.reportId,
      approval: { op: "delete", dateYmd: DATE, snapshotHash: preview.snapshotHash, reportId: c.reportId }, dataDir: ctx.dataDir,
    });
    expect(denied.ok).toBe(false);
    const r = await approveAndApply(ctx, "delete", undefined, c.reportId);
    expect(r.ok, r.errors.join(";")).toBe(true);
    expect(ctx.server.posted.at(-1)?.form.get("personal_id")).toBe(String(USER_ID));
    expect(ctx.server.reports).toHaveLength(0);
  });

  it("transporte no verificado bloquea como fallo definitivo (journal no queda abierto)", async () => {
    const ctx = await setup();
    const r = await approveAndApply(ctx, "create", draft({ transportLabel: "Bicicleta", transportIsDailyOverride: true }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no verificado/);
    expect(ctx.server.posted).toHaveLength(0);
    expect(riporJournalBlocksMutations(await loadRiporJournal(ctx.dataDir)).blocked).toBe(false);
  });

  it("error de red durante el POST → journal unknown y bloquea reintentos", async () => {
    const ctx = await setup({ failPostWithNetwork: true });
    const r = await approveAndApply(ctx, "create", draft());
    expect(r.ok).toBe(false);
    expect((await loadRiporJournal(ctx.dataDir)).at(-1)?.status).toBe("unknown");
    expect(riporJournalBlocksMutations(await loadRiporJournal(ctx.dataDir)).blocked).toBe(true);
  });

  it("sesión vencida (redirect a login) se reporta sin mutar ni abrir journal", async () => {
    const server = fakeRipor();
    const client = createRiporHttpClient(sessionHandle({}).handle, server.fetchImpl);
    await expect(client.getReports(DATE)).rejects.toBeInstanceOf(RiporSessionExpiredError);
    const adapter = createHttpRiporAdapter({ client, profile: profile() });
    expect((await adapter.ensureSession({ allowHeadedLogin: false })).status).toBe("expired");
  });

  it("persiste cookies refrescadas por el servidor (Set-Cookie)", async () => {
    const ctx = await setup({ setCookieOnce: `${AUTH}.0=${syntheticAuthValue(5_000_000_000)}; Path=/` });
    await ctx.client.getReports(DATE);
    expect(ctx.session.refreshed).toHaveLength(1);
  });

  it("openRiporHttp falla claro si no hay sesión guardada", async () => {
    await expect(openRiporHttp(profile(), { store: createFakeSecretStore() })).rejects.toThrow(/ripor login/);
  });
});
