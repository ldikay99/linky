import { describe, expect, it } from "vitest";
import { colombiaHolidays, easterSunday, holidayName } from "../agent/lib/ripor/holidays.js";
import { classifyMonth } from "../agent/lib/ripor/month.js";
import { evaluateRiporPolicy } from "../agent/lib/ripor/policy.js";
import { buildRiporProfileFromSetup } from "../agent/lib/ripor/setup.js";
import { findDates, noDatesError, stripDates } from "../agent/lib/planning/noDates.js";
import { validateDescription } from "../agent/lib/planning/description.js";
import { linkyClientKeyMarker } from "../agent/lib/azure/attachments.js";

describe("festivos de Colombia (Ley Emiliani)", () => {
  it("Pascua y festivos 2026 completos", () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect([...colombiaHolidays(2026).keys()].sort()).toEqual([
      "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18", "2026-06-08",
      "2026-06-15", "2026-06-29", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02", "2026-11-16",
      "2026-12-08", "2026-12-25",
    ]);
  });

  it("festivos que coinciden muestran ambos nombres; extra configurados", () => {
    expect(holidayName("2025-06-30")).toBe("San Pedro y San Pablo y Sagrado Corazón");
    expect(holidayName("2026-11-03")).toBeUndefined();
    expect(holidayName("2026-11-03", ["2026-11-03"])).toBe("Festivo configurado");
  });
});

describe("ripor month", () => {
  it("clasifica laborables, festivos, fin de semana y extra; calcula pendientes", () => {
    const r = classifyMonth({
      monthYm: "2026-11",
      todayYmd: "2026-11-09",
      reportedByDay: { "2026-11-03": 8.5, "2026-11-04": 4, "2026-11-06": 8, "2026-11-07": 3 },
    });
    const by = Object.fromEntries(r.dias.map((d) => [d.fecha.slice(8), d.estado]));
    expect(by["01"]).toBe("fin de semana");
    expect(by["02"]).toBe("festivo");
    expect(by["03"]).toBe("completo");
    expect(by["04"]).toBe("incompleto");
    expect(by["05"]).toBe("falta");
    expect(by["06"]).toBe("completo"); // viernes 8 h
    expect(by["07"]).toBe("extra"); // sábado trabajado: se respeta, no se exige
    expect(by["09"]).toBe("falta");
    expect(by["10"]).toBe("futuro");
    expect(r.totales.diasPendientes).toEqual(["2026-11-04", "2026-11-05", "2026-11-09"]);
    expect(r.totales.faltante).toBe(4.5 + 8.5 + 8.5);
  });
});

describe("sin fechas en descripciones", () => {
  it("detecta formatos de fecha comunes y deja pasar números normales", () => {
    expect(findDates("Ajustes del 04/11 y del 2026-11-05").sort()).toEqual(["04/11", "2026-11-05"]);
    expect(findDates("Reunión del 4 de noviembre")).toEqual(["4 de noviembre"]);
    expect(findDates("Se revisó nov 4 el despliegue")).toEqual(["nov 4"]);
    expect(findDates("Se corrigieron 3 errores en la versión 2 del módulo")).toEqual([]);
    expect(noDatesError("Despliegue en UAT validado")).toBeUndefined();
    expect(findDates("Se escribieron 2-3 frases y se dedicó 1/2 hora")).toEqual([]);
    expect(findDates("Entregado el 4-11-2026 y el 4/11/26").sort()).toEqual(["4-11-2026", "4/11/26"]);
    expect(findDates("Corte del 4/11")).toEqual(["4/11"]);
  });

  it("quita fechas de textos sugeridos", () => {
    expect(stripDates("Validación en UAT del 04/11")).toBe("Validación en UAT");
  });

  it("Ripor bloquea descripciones con fecha; Azure también", () => {
    const profile = buildRiporProfileFromSetup({
      uiObserved: true,
      uiAreaProjects: [{ label: "Área", verifiedFromUi: true }],
      chosenAreaProjectLabel: "Área",
      uiTransportOptions: [{ label: "🏠 Trabajo Remoto", formValue: "trabajo_remoto", verifiedFromUi: true }],
      chosenTransportLabel: "🏠 Trabajo Remoto",
    }).profile!;
    const res = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-04",
      existingSameDay: [],
      profile,
      coverageProof: { sustainedActivityHours: 8.5, coversDraftDedication: true, source: "azure_confirmed" },
      draft: {
        dateYmd: "2026-11-04",
        areaProjectLabel: "Área",
        taskLabel: "Tarea Personalizada",
        hours: 8.5,
        description: "Como referencia de Azure del 04/11: gestión de accesos y validación en UAT del módulo.",
        evidenceUrls: ["https://example.com/e"],
        transportLabel: "🏠 Trabajo Remoto",
        transportIsDailyOverride: false,
      },
    });
    expect(res.blockers.join(" ")).toMatch(/no lleva fechas \(04\/11\)/);
    const az = validateDescription("Se validó el despliegue del 2026-11-04", "done", { planningTense: "future", executionTense: "past", maxChars: 500, requireShortDirect: true });
    expect(az.errors.join(" ")).toMatch(/no lleva fechas/);
  });

  it("el marcador oculto de Azure no contiene la fecha de la clave", () => {
    const marker = linkyClientKeyMarker("create::2026-11-05::act-1::Demo");
    expect(marker).not.toMatch(/2026/);
    expect(marker).toMatch(/^<!--ref=[0-9a-f]{16}-->$/);
  });

  it("Ripor bloquea festivos", () => {
    const profile = buildRiporProfileFromSetup({
      uiObserved: true,
      uiAreaProjects: [{ label: "Área", verifiedFromUi: true }],
      chosenAreaProjectLabel: "Área",
      uiTransportOptions: [{ label: "🏠 Trabajo Remoto", formValue: "trabajo_remoto", verifiedFromUi: true }],
      chosenTransportLabel: "🏠 Trabajo Remoto",
    }).profile!;
    const res = evaluateRiporPolicy({
      op: "create",
      dateYmd: "2026-11-16",
      existingSameDay: [],
      profile,
      coverageProof: { sustainedActivityHours: 8.5, coversDraftDedication: true, source: "azure_confirmed" },
      draft: {
        dateYmd: "2026-11-16",
        areaProjectLabel: "Área",
        taskLabel: "Tarea Personalizada",
        hours: 8.5,
        description: "Desarrollo y pruebas sintéticas de integración en el módulo demo del proyecto.",
        evidenceUrls: ["https://example.com/e"],
        transportLabel: "🏠 Trabajo Remoto",
        transportIsDailyOverride: false,
      },
    });
    expect(res.blockers.join(" ")).toMatch(/Festivo \(Independencia de Cartagena\)/);
  });
});
