import { describe, expect, it } from "vitest";
import { parseFixedHours, proposeHours } from "../agent/lib/azure/hours.js";
import { classifyEvent, normalizeTitle } from "../agent/lib/calendar/meetings.js";
import { commitUrl, webBaseFromRemote, workItemRefs } from "../agent/lib/dev/git.js";
import { azureProjectsFromBases } from "../agent/lib/dev/prs.js";

const task = (id: number, activity: number, completed = 0) => ({ id, title: `Tarea ${id}`, project: "P", completed, rev: 3, activity });

describe("horas reales (propuesta)", () => {
  it("reparte lo pendiente según actividad, en cuartos de hora, sin pasarse", () => {
    const p = proposeHours({ dateYmd: "2026-11-04", jornada: 8.5, yaRegistradas: 2, reunionesConfirmadas: 0.5, tasks: [task(1, 3), task(2, 1)] });
    expect(p.pendiente).toBe(6);
    const total = p.tareas.reduce((s, t) => s + t.propuesta, 0);
    expect(total).toBe(6);
    expect(p.tareas.find((t) => t.id === 1)!.propuesta).toBe(4.5);
    for (const t of p.tareas) expect((t.propuesta * 4) % 1).toBe(0);
    expect(p.avisos.join(" ")).toMatch(/--meetings-task/);
  });

  it("respeta horas fijadas y asigna reuniones a la Task indicada", () => {
    const p = proposeHours({ dateYmd: "2026-11-04", jornada: 8.5, yaRegistradas: 0, reunionesConfirmadas: 2, tasks: [task(1, 1), task(2, 1), task(9, 0)], fixed: { 1: 3 }, meetingsTaskId: 9 });
    const by = Object.fromEntries(p.tareas.map((t) => [t.id, t.propuesta]));
    expect(by[1]).toBe(3);
    expect(by[2]).toBe(3.5); // 8.5 − 2 (reuniones) − 3 (fijada)
    expect(by[9]).toBe(2);
  });

  it("no inventa: sin Tasks del día avisa; jornada completa no propone", () => {
    expect(proposeHours({ dateYmd: "d", jornada: 8.5, yaRegistradas: 0, reunionesConfirmadas: 0, tasks: [] }).avisos.join(" ")).toMatch(/preguntar a la persona/);
    expect(proposeHours({ dateYmd: "d", jornada: 8.5, yaRegistradas: 8.5, reunionesConfirmadas: 0, tasks: [task(1, 2)] }).tareas).toEqual([]);
  });

  it("--set acepta id=horas y rechaza formatos inválidos", () => {
    expect(parseFixedHours("558412=2, #558413=1,5")).toEqual({ 558412: 2, 558413: 1.5 });
    expect(() => parseFixedHours("558412")).toThrow(/--set inválido/);
  });
});

describe("reuniones confirmadas", () => {
  const rules = { version: 1 as const, meetings: [normalizeTitle("Reunión de QA CRM")], ignore: [normalizeTitle("Pausa Activa")] };
  it("confirmadas, ignoradas y sin confirmar (sin tildes ni mayúsculas)", () => {
    expect(classifyEvent("Reunion de QA  CRM - DATA", rules)).toBe(true);
    expect(classifyEvent("[Pausa Activa AM] ¡Activemos juntos!", rules)).toBe(false);
    expect(classifyEvent("Charla de bienestar", rules)).toBeNull();
  });
});

describe("dev: commits y PRs", () => {
  it("remotos sin credenciales y enlaces a commits (Azure / GitHub)", () => {
    expect(webBaseFromRemote("https://usuario:token-secreto@dev.azure.com/Org/Proyecto%20X/_git/repo")).toBe("https://dev.azure.com/Org/Proyecto%20X/_git/repo");
    expect(webBaseFromRemote("https://Org@dev.azure.com/Org/P/_git/r")).toBe("https://dev.azure.com/Org/P/_git/r");
    expect(webBaseFromRemote("git@ssh.dev.azure.com:v3/Org/P/r")).toBe("https://dev.azure.com/Org/P/_git/r");
    expect(webBaseFromRemote("git@github.com:dueno/repo.git")).toBe("https://github.com/dueno/repo");
    expect(webBaseFromRemote("https://x:ghp_token@github.com/dueno/repo.git")).toBe("https://github.com/dueno/repo");
    expect(webBaseFromRemote("file:///tmp/repo")).toBeUndefined();
    expect(commitUrl("https://github.com/d/r", "abc")).toBe("https://github.com/d/r/commit/abc");
  });

  it("referencias a work items y proyectos por organización", () => {
    expect(workItemRefs("fix: filtros AB#558412 y #558413", true)).toEqual([558412, 558413]);
    expect(workItemRefs("fix #12 AB#558412", false)).toEqual([558412]);
    expect(
      azureProjectsFromBases(
        ["https://dev.azure.com/Org/Proyecto%20A/_git/r1", "https://dev.azure.com/Otra/B/_git/r2", "https://github.com/d/r"],
        "https://dev.azure.com/Org",
      ),
    ).toEqual(["Proyecto A"]);
  });
});

describe("avisos proactivos", async () => {
  const { buildAlerts } = await import("../agent/lib/alerts/alerts.js");
  const base = { todayYmd: "2026-11-05", nowHHmm: "17:40", laborableHoy: true, finJornadaHHmm: "17:30", pats: [], tareasEnCurso: [] };

  it("Ripor incompleto al final de la jornada es alta; días pasados pendientes del mes", () => {
    const a = buildAlerts({ ...base, ripor: { reportadoHoy: 0, esperadoHoy: 8.5, diasPendientesMes: ["2026-11-03", "2026-11-05"], sesion: true } });
    expect(a[0]).toMatchObject({ nivel: "alta", area: "ripor" });
    expect(a.map((x) => x.mensaje).join(" ")).toMatch(/1 día\(s\) del mes sin completar en Ripor: 2026-11-03/);
    const temprano = buildAlerts({ ...base, nowHHmm: "10:00", ripor: { reportadoHoy: 0, esperadoHoy: 8.5, diasPendientesMes: [], sesion: true } });
    expect(temprano[0].nivel).toBe("media");
  });

  it("PAT por vencer, vencido o sin fecha; Task estancada; huérfanos y Google", () => {
    const a = buildAlerts({
      ...base,
      pats: [
        { organizacion: "https://dev.azure.com/A", vence: "2026-11-09" },
        { organizacion: "https://dev.azure.com/B", vence: "2026-11-01" },
        { organizacion: "https://dev.azure.com/C" },
        { organizacion: "https://dev.azure.com/D", vence: "2027-04-02", funciona: false },
        { organizacion: "https://dev.azure.com/E", vence: "2027-04-02" },
      ],
      avisosAzure: [
        { organization: "C", expiresOn: "2026-11-10" },
        { organization: "E", expiresOn: "2026-11-10" }, // token viejo: no es el que usa Linky
      ],
      tareasEnCurso: [{ id: 7, titulo: "Vieja", desde: "2026-10-20T10:00:00Z" }, { id: 8, titulo: "Nueva", desde: "2026-11-04T10:00:00Z" }],
      huerfanos: 3,
      google: false,
    });
    const text = a.map((x) => `${x.nivel}:${x.mensaje}`).join(" | ");
    expect(text).toMatch(/media:El PAT de https:\/\/dev.azure.com\/A vence en 4 día/);
    expect(text).toMatch(/alta:El PAT de https:\/\/dev.azure.com\/B venció/);
    expect(text).not.toMatch(/Sin fecha/);
    expect(text).toMatch(/media:Azure avisa que un PAT de https:\/\/dev.azure.com\/C vence el 2026-11-10/);
    expect(text).not.toMatch(/dev.azure.com\/E vence el 2026-11-10/);
    expect(text).toMatch(/alta:El PAT de https:\/\/dev.azure.com\/D ya no funciona/);
    expect(text).toMatch(/#7 "Vieja" lleva 16 días en curso/);
    expect(text).not.toMatch(/#8/);
    expect(text).toMatch(/3 navegador\(es\) de Linky huérfanos/);
    expect(text).toMatch(/Sin sesión de Google/);
    expect(a[0].nivel).toBe("alta");
  });
});

describe("HU donde colgar Tasks", async () => {
  const { candidateParentHus } = await import("../agent/lib/azure/hus.js");
  it("lista HU abiertas de los sprints de la persona, con sus Tasks primero; excluye cerradas", async () => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });
    let wiqlCalls = 0;
    const f = (async (input: string | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes("/_apis/wit/wiql")) return json({ workItems: wiqlCalls++ === 0 ? [{ id: 10 }, { id: 11 }] : [{ id: 100 }, { id: 101 }, { id: 102 }] });
      if (u.includes("workitemsbatch")) {
        const ids = JSON.parse(String(init?.body)).ids as number[];
        if (ids.includes(10)) return json({ value: [{ id: 10, fields: { "System.Parent": 100, "System.IterationPath": "P\\S18" } }, { id: 11, fields: { "System.Parent": 100, "System.IterationPath": "P\\S18" } }] });
        const hu = (id: number, state: string) => ({ id, fields: { "System.Title": `HU ${id}`, "System.State": state, "System.IterationPath": "P\\S18", "System.TeamProject": "P", "System.CreatedBy": { displayName: "Líder Demo" }, "System.WorkItemType": "User Story" } });
        return json({ value: [hu(100, "En Curso"), hu(101, "Nueva"), hu(102, "Cerrada")] });
      }
      if (u.includes("/states")) return json({ value: [{ name: "Nueva", category: "Proposed" }, { name: "En Curso", category: "InProgress" }, { name: "Cerrada", category: "Completed" }] });
      return new Response("x", { status: 404 });
    }) as typeof fetch;
    const hus = await candidateParentHus({ organizationUrl: "https://dev.azure.com/Org", auth: { pat: "synthetic-pat-x" }, fetchImpl: f });
    expect(hus.map((h) => [h.id, h.tusTasks])).toEqual([[100, 2], [101, 0]]);
    expect(hus[0]).toMatchObject({ sprint: "S18", creadaPor: "Líder Demo", url: "https://dev.azure.com/Org/P/_workitems/edit/100" });
  });
});
