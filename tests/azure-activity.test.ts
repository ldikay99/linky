import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readDayActivity } from "../agent/lib/azure/activity.js";
import { assertAzureAuthenticated, azureAuthHeaders } from "../agent/lib/azure/client.js";
import { loadAzureOrgs, readOrgPat, registerAzureOrg, saveOrgPat, setPrimaryAzureOrg } from "../agent/lib/azure/orgs.js";
import { evaluateRiporPolicy } from "../agent/lib/ripor/policy.js";
import { buildRiporProfileFromSetup } from "../agent/lib/ripor/setup.js";
import { createFakeSecretStore } from "../agent/lib/security/secretStore.js";

const ORG = "https://dev.azure.com/ExampleOrg";
const ME = "user-me";

/** Azure DevOps falso: connectionData, WIQL, workitemsbatch y updates. */
function fakeAzure() {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const headers = new Headers(init?.headers);
    if (!headers.get("authorization") && !headers.get("cookie")) {
      return new Response("<html>login</html>", { status: 203, headers: { "content-type": "text/html" } });
    }
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/_apis/connectionData")) {
      return json({ authenticatedUser: { id: ME, providerDisplayName: "Persona Demo" } });
    }
    if (url.pathname.endsWith("/_apis/wit/wiql")) return json({ workItems: [{ id: 1 }, { id: 2 }] });
    if (url.pathname.endsWith("/_apis/wit/workitemsbatch")) {
      return json({
        value: [
          { id: 1, fields: { "System.Title": "Tarea demo A", "System.WorkItemType": "Task", "System.State": "3. Entregado", "System.TeamProject": "Proyecto Demo" } },
          { id: 2, fields: { "System.Title": "Tarea de otro día", "System.WorkItemType": "Task", "System.State": "Active", "System.TeamProject": "Proyecto Demo" } },
        ],
      });
    }
    const m = /workItems\/(\d+)\/updates/.exec(url.pathname);
    if (m && m[1] === "1") {
      return json({
        value: [
          { id: 1, rev: 1, revisedBy: { id: ME }, fields: { "System.ChangedDate": { newValue: "2026-11-04T14:00:00Z" }, "System.State": { newValue: "1. En Planeacion" } } },
          {
            id: 2,
            rev: 2,
            revisedBy: { id: ME },
            fields: {
              "System.ChangedDate": { newValue: "2026-11-04T20:00:00Z" },
              "System.State": { oldValue: "1. En Planeacion", newValue: "3. Entregado" },
              "Microsoft.VSTS.Scheduling.CompletedWork": { oldValue: 1, newValue: 3.5 },
              "System.History": { newValue: "<div>Listo&nbsp;en UAT</div>" },
            },
          },
          // De otra persona: no cuenta.
          { id: 3, rev: 3, revisedBy: { id: "otra" }, fields: { "System.ChangedDate": { newValue: "2026-11-04T21:00:00Z" } } },
        ],
      });
    }
    if (m && m[1] === "2") {
      // Cambio a las 02:00Z del 05 = 21:00 del 04 en Bogotá → sí cuenta en zona local.
      return json({ value: [{ id: 1, rev: 5, revisedBy: { id: ME }, fields: { "System.ChangedDate": { newValue: "2026-11-05T02:00:00Z" } } }] });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("azure activity del día", () => {
  it("solo cuenta cambios propios en la fecha local; suma horas y limpia comentarios", async () => {
    const { fetchImpl } = fakeAzure();
    const r = await readDayActivity({ organizationUrl: ORG, auth: { pat: "synthetic-pat-x" }, dateYmd: "2026-11-04", timeZone: "America/Bogota", fetchImpl });
    expect(r.user).toBe("Persona Demo");
    expect(r.items.map((i) => i.id)).toEqual([1, 2]);
    const a = r.items[0];
    expect(a.createdToday).toBe(true);
    expect(a.stateChanges).toEqual(["∅ → 1. En Planeacion", "1. En Planeacion → 3. Entregado"]);
    expect(a.completedWorkDelta).toBe(2.5);
    expect(a.comments).toEqual(["Listo en UAT"]);
    expect(a.url).toBe(`${ORG}/Proyecto%20Demo/_workitems/edit/1`);
    expect(r.completedWorkHours).toBe(2.5);
  });

  it("en UTC el cambio de las 02:00Z cae en otro día", async () => {
    const { fetchImpl } = fakeAzure();
    const r = await readDayActivity({ organizationUrl: ORG, auth: { pat: "synthetic-pat-x" }, dateYmd: "2026-11-04", timeZone: "UTC", fetchImpl });
    expect(r.items.map((i) => i.id)).toEqual([1]);
  });

  it("sin auth válida Azure responde 203/HTML → error claro", () => {
    const res = new Response("<html/>", { status: 203, headers: { "content-type": "text/html" } });
    expect(() => assertAzureAuthenticated(res)).toThrow(/AZURE_AUTH_INVALID/);
    expect(azureAuthHeaders({ cookie: "a=b" })["X-TFS-FedAuthRedirect"]).toBe("Suppress");
    expect(() => azureAuthHeaders({})).toThrow();
  });
});

describe("varias organizaciones", () => {
  it("registra principal + secundaria con PAT propio cada una, sin secretos en el registro", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "linky-orgs-"));
    const store = createFakeSecretStore();
    await saveOrgPat(store, "https://dev.azure.com/EmpresaA", "synthetic-pat-a");
    await saveOrgPat(store, "https://dev.azure.com/ClienteB", "synthetic-pat-b");
    await registerAzureOrg({ organizationUrl: "https://dev.azure.com/EmpresaA", auth: "pat" }, { primary: true, dataDir });
    await registerAzureOrg({ organizationUrl: "https://dev.azure.com/ClienteB", auth: "pat" }, { dataDir });
    let reg = await loadAzureOrgs(dataDir);
    expect(reg.primary).toBe("https://dev.azure.com/EmpresaA");
    expect(reg.orgs).toHaveLength(2);
    expect(JSON.stringify(reg)).not.toContain("synthetic-pat");
    expect(await readOrgPat(store, "https://dev.azure.com/clienteb")).toBe("synthetic-pat-b");
    reg = await setPrimaryAzureOrg("https://dev.azure.com/ClienteB", dataDir);
    expect(reg.primary).toBe("https://dev.azure.com/ClienteB");
    await expect(setPrimaryAzureOrg("https://dev.azure.com/NoExiste", dataDir)).rejects.toThrow(/no registrada/);
  });
});

describe("descripción breve Ripor", () => {
  const profile = buildRiporProfileFromSetup({
    uiObserved: true,
    uiAreaProjects: [{ label: "Área", verifiedFromUi: true }],
    chosenAreaProjectLabel: "Área",
    uiTransportOptions: [{ label: "🏠 Trabajo Remoto", formValue: "trabajo_remoto", verifiedFromUi: true }],
    chosenTransportLabel: "🏠 Trabajo Remoto",
  }).profile!;
  const base = {
    op: "create" as const,
    dateYmd: "2026-11-04",
    existingSameDay: [],
    profile,
    coverageProof: { sustainedActivityHours: 8.5, coversDraftDedication: true as const, source: "azure_confirmed" as const },
  };
  const draft = (description: string) => ({
    dateYmd: "2026-11-04",
    areaProjectLabel: "Área",
    taskLabel: "Tarea Personalizada",
    hours: 8.5,
    description,
    evidenceUrls: ["https://example.com/e"],
    transportLabel: "🏠 Trabajo Remoto",
    transportIsDailyOverride: false,
  });

  it("exige mínimo 50 (regla del formulario Ripor) y máximo breve (500 por defecto)", () => {
    expect(evaluateRiporPolicy({ ...base, draft: draft("Muy corta.") }).blockers.join(" ")).toMatch(/mínimo 50/);
    expect(evaluateRiporPolicy({ ...base, draft: draft("x".repeat(501)) }).blockers.join(" ")).toMatch(/no es breve/);
    expect(evaluateRiporPolicy({ ...base, draft: draft("y".repeat(120)) }).ok).toBe(true);
    expect(evaluateRiporPolicy({ ...base, profile: { ...profile, descriptionMaxChars: 100 }, draft: draft("y".repeat(120)) }).ok).toBe(false);
  });

  it("fin de semana: bloqueado salvo trabajo extra que la persona pidió, con tope de una jornada", () => {
    const sabado = { ...base, dateYmd: "2026-11-07", coverageProof: { ...base.coverageProof, sustainedActivityHours: 4 } };
    const d = { ...draft("Se atendió el despliegue programado del fin de semana con el equipo de soporte."), dateYmd: "2026-11-07", hours: 4 };
    expect(evaluateRiporPolicy({ ...sabado, draft: d }).ok).toBe(false);
    expect(evaluateRiporPolicy({ ...sabado, draft: { ...d, nonWorkdayConfirmed: true } }).ok).toBe(true);
    const largo = { ...d, hours: 10, nonWorkdayConfirmed: true };
    expect(evaluateRiporPolicy({ ...sabado, coverageProof: { ...base.coverageProof, sustainedActivityHours: 10 }, draft: largo }).ok).toBe(false);
  });
});

describe("campos obligatorios al crear Task", async () => {
  const { inferFromSiblings, pickWritableFields } = await import("../agent/lib/azure/fields.js");
  const meta = {
    workItemType: "Task",
    states: [],
    transitions: [],
    fields: [
      { referenceName: "System.Title", name: "Title", type: "string", required: true, readOnly: false },
      { referenceName: "System.IterationId", name: "Iteration ID", type: "integer", required: true, readOnly: false },
      { referenceName: "System.IterationPath", name: "Iteration Path", type: "treePath", required: false, readOnly: false },
      { referenceName: "System.State", name: "State", type: "string", required: true, readOnly: false, defaultValue: "Nuevo" },
      { referenceName: "Custom.Sub", name: "Sub", type: "string", required: true, readOnly: false, allowedValues: ["N/A", "QA"] },
    ],
  };

  it("default del proceso e Iteración por ruta no bloquean; valor no permitido sí", () => {
    const ok = pickWritableFields(meta, { "System.Title": "t", "System.IterationPath": "P\S1", "Custom.Sub": "N/A" });
    expect(ok.missingRequired).toEqual([]);
    const bad = pickWritableFields(meta, { "System.Title": "t", "System.IterationPath": "P\S1", "Custom.Sub": "Inventado" });
    expect(bad.missingRequired).toEqual(["Custom.Sub"]);
    expect(bad.skipped.join(" ")).toMatch(/no es un valor permitido/);
  });

  it("infiere el valor más usado entre Tasks hermanas", async () => {
    const values: Record<number, string> = { 10: "N/A", 11: "N/A", 12: "QA" };
    const client = { getWorkItem: async (id: number) => ({ id, rev: 1, fields: { "Custom.Sub": values[id] } }) } as never;
    expect(await inferFromSiblings(client, [10, 11, 12], ["Custom.Sub"])).toEqual({ "Custom.Sub": "N/A" });
  });
});

describe("bienvenida", () => {
  it("muestra logo y créditos; sin color en salida capturada", async () => {
    const { renderBanner } = await import("../agent/lib/cli/banner.js");
    const plain = renderBanner({ color: false });
    expect(plain).toContain("██╗     ██╗███╗   ██╗");
    expect(plain).toContain("por Jonathan Contreras");
    expect(plain).not.toContain("\x1b[");
    expect(renderBanner({ color: true })).toContain("\x1b[");
  });
});

describe("google chat (determinista)", () => {
  it("reconoce conversaciones de Chat standalone y dentro de Gmail; rechaza home/marketing", async () => {
    const { isConversationUrl } = await import("../agent/lib/chat/browser.js");
    expect(isConversationUrl("https://chat.google.com/u/0/app/chat/AbCdEf12345")).toBe(true);
    expect(isConversationUrl("https://chat.google.com/room/AAAAxyz")).toBe(true);
    expect(isConversationUrl("https://mail.google.com/chat/u/0/#chat/dm/AbC123")).toBe(true);
    expect(isConversationUrl("https://mail.google.com/mail/u/0/#chat/space/AAAA123")).toBe(true);
    expect(isConversationUrl("https://chat.google.com/")).toBe(false);
    expect(isConversationUrl("https://workspace.google.com/products/chat/")).toBe(false);
  });

  it("el hash del borrador cambia con el texto o el destino", async () => {
    const { chatDraftHash } = await import("../agent/lib/cli/chatCmd.js");
    const a = chatDraftHash("hola", "https://chat.google.com/u/0/app/chat/X1");
    expect(chatDraftHash("hola", "https://chat.google.com/u/0/app/chat/X1")).toBe(a);
    expect(chatDraftHash("hola!", "https://chat.google.com/u/0/app/chat/X1")).not.toBe(a);
    expect(chatDraftHash("hola", "https://chat.google.com/u/0/app/chat/X2")).not.toBe(a);
  });
});

describe("mensajes de inicio y cierre", async () => {
  const { renderDayMessage } = await import("../agent/lib/chat/dayMessages.js");
  const task = (id: number, title: string) => ({ id, title, state: "x", category: "InProgress", project: "P", url: `https://e/${id}` });

  it("usa la plantilla del área y marca listas vacías", () => {
    const msg = renderDayMessage(
      "cierre",
      { dateYmd: "2026-11-04", entregadas: [task(1, "Uno")], en_curso: [] },
      { cierre: "[{fecha}] OK: {entregadas} | Sigue: {en_curso}", item: "#{id}", vacio: "nada" },
    );
    expect(msg).toBe("[04/11] OK: #1 | Sigue: nada");
  });

  it("se ajusta al tope: acorta títulos y luego agrupa, sin perder los números visibles", () => {
    const many = Array.from({ length: 12 }, (_, i) => task(100 + i, "Título bastante largo de una tarea de ejemplo número " + i));
    const msg = renderDayMessage("inicio", { dateYmd: "2026-11-05", tareas: many }, {}, 300);
    expect(msg.length).toBeLessThanOrEqual(300);
    expect(msg).toContain("#100");
    expect(msg).toMatch(/… y \d+ más/);
  });
});

describe("lecturas Azure con reintento", async () => {
  const { azureReadJson } = await import("../agent/lib/azure/http.js");
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  it("reintenta cortes de red y 5xx; responde al recuperarse", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      if (calls === 2) return json({}, 503);
      return json({ ok: true });
    }) as typeof fetch;
    expect(await azureReadJson(f, "https://dev.azure.com/X/_apis/a", {})).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("no reintenta sesión inválida ni errores definitivos", async () => {
    let calls = 0;
    const html = (async () => {
      calls++;
      return new Response("<html/>", { status: 203, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    await expect(azureReadJson(html, "https://dev.azure.com/X/_apis/a", {})).rejects.toThrow(/AZURE_AUTH_INVALID/);
    expect(calls).toBe(1);
    calls = 0;
    const notFound = (async () => {
      calls++;
      return json({ message: "no" }, 404);
    }) as typeof fetch;
    await expect(azureReadJson(notFound, "https://dev.azure.com/X/_apis/a", {})).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });
});

describe("sugerencia de Ripor", async () => {
  const { buildRiporNotes, suggestionWarnings } = await import("../agent/lib/ripor/suggest.js");
  const item = (id: number, title: string, delivered = true) => ({
    id, title, type: "Task", project: "Proyecto Demo", state: "Entregado", url: `https://e/${id}`,
    createdToday: delivered, stateChanges: delivered ? ["a → b"] : [], completedWorkDelta: 1, comments: [], changedAt: [],
  });
  const day = (items: ReturnType<typeof item>[]) => ({ dateYmd: "2026-11-04", timeZone: "UTC", user: "x", items, completedWorkHours: items.length });

  it("agrupa por sufijo de área y respeta el tope", () => {
    const notes = buildRiporNotes(day([item(1, "Ajustar filtros - ModuloA"), item(2, "Validar en UAT - ModuloA"), item(3, "Revisar estilos")]));
    expect(notes).toBe("ModuloA: ajustar filtros; validar en UAT. Proyecto Demo: revisar estilos.");
    const many = day(Array.from({ length: 30 }, (_, i) => item(i, `Tarea muy descriptiva número ${i} con bastante texto - ModuloA`)));
    const capped = buildRiporNotes(many, 300);
    expect(capped.length).toBeLessThanOrEqual(300);
    expect(capped).toMatch(/tarea\(s\) más/);
  });

  it("avisa sin inventar cuando Azure no sustenta la jornada", () => {
    const w = suggestionWarnings({ notes: "corta", evidence: undefined, sustainedHours: 3, expectedHours: 8.5 });
    expect(w.join(" ")).toMatch(/mínimo 50/);
    expect(w.join(" ")).toMatch(/Sin evidencia/);
    expect(w.join(" ")).toMatch(/sustenta 3 h de 8.5 h/);
  });
});
