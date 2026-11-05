import type { BrowserCapabilities } from "./capabilities.js";
import { defaultBrowserCapabilities } from "./capabilities.js";
import { riporBrowserProfileDir } from "./paths.js";

export type RiporUiSessionStatus = "unknown" | "needs_login" | "authenticated" | "expired";

/**
 * Adaptador UI Ripor. Solo operaciones de UI de alto nivel.
 * Implementación real la provee el host con MCP Playwright; aquí hay mock + stub no productivo.
 */
export type RiporUiAdapter = {
  kind: "mock" | "playwright_mcp" | "http" | "unimplemented";
  capabilities: BrowserCapabilities;
  ensureSession(opts: { allowHeadedLogin: boolean; dataDir?: string }): Promise<{
    status: RiporUiSessionStatus;
    profileDir: string;
    message: string;
  }>;
  /** Lista opciones visibles de proyecto de área (labels). */
  listAreaProjects(): Promise<string[]>;
  listTaskLabels(): Promise<string[]>;
  listTransportLabels(): Promise<string[]>;
  /** Reportes existentes del día (solo lo que la UI expone). */
  listReportsForDate(dateYmd: string): Promise<Array<{ id: string; dateYmd: string; hours: number; summary?: string }>>;
  /**
   * Aplicar cambio UI tras aprobación. Mock no toca red.
   * Playwright real: solo fill/click en formularios públicos, sin APIs internas.
   */
  applyUiAction(action: {
    op: "create" | "update" | "delete";
    dateYmd: string;
    reportId?: string;
    fields?: Record<string, string>;
  }): Promise<{ ok: boolean; message: string; reportId?: string }>;
};

export function createUnimplementedRiporAdapter(): RiporUiAdapter {
  const capabilities = defaultBrowserCapabilities({
    notes: [
      ...defaultBrowserCapabilities().notes,
      "Adapter unimplemented: el host debe inyectar Playwright MCP. No es producción.",
    ],
  });
  const fail = async () => {
    throw new Error(
      "Ripor UI adapter no implementado en este proceso. Use mock en tests o inyección Playwright del host.",
    );
  };
  return {
    kind: "unimplemented",
    capabilities,
    ensureSession: async ({ dataDir }) => ({
      status: "unknown",
      profileDir: riporBrowserProfileDir(dataDir),
      message:
        "Sesión no gestionada aquí. Parent/computerUse debe abrir headed solo si falta login; no extraer cookies.",
    }),
    listAreaProjects: fail,
    listTaskLabels: fail,
    listTransportLabels: fail,
    listReportsForDate: fail,
    applyUiAction: fail,
  };
}

/** Mock sintético — labels claramente no verificados en UI real. */
export function createMockRiporUiAdapter(seed?: {
  projects?: string[];
  tasks?: string[];
  transports?: string[];
  existing?: Record<string, Array<{ id: string; hours: number; summary?: string }>>;
}): RiporUiAdapter {
  const state = {
    projects: seed?.projects ?? ["[MOCK no verificado] Área Demo A", "[MOCK no verificado] Área Demo B"],
    tasks: seed?.tasks ?? ["Tarea Personalizada", "[MOCK no verificado] Otra tarea"],
    transports: seed?.transports ?? [
      "[MOCK no verificado] trabajo remoto",
      // Observed label lives in uiObservations; mock list stays synthetic unless seed overrides.
      "[MOCK no verificado] vehiculo particular",
      "[MOCK no verificado] moto particular",
      "[MOCK no verificado] transporte publico",
      "[MOCK no verificado] carro compartido",
      "[MOCK no verificado] bicicleta",
      "[MOCK no verificado] patineta electrica",
      "[MOCK no verificado] apps de movilidad",
    ],
    existing: seed?.existing ?? ({} as Record<string, Array<{ id: string; hours: number; summary?: string }>>),
    nextId: 1,
    pending: false,
  };

  return {
    kind: "mock",
    capabilities: defaultBrowserCapabilities({
      playwrightMcpAvailable: false,
      headedLoginSupported: false,
      headlessReuseSupported: false,
      canNavigateInThisProcess: false,
      notes: [
        "Mock sintético: no es UI Ripor real. Labels marcados [MOCK no verificado].",
        "No usar como prueba de selectores de producción.",
      ],
    }),
    async ensureSession({ dataDir }) {
      return {
        status: "authenticated",
        profileDir: riporBrowserProfileDir(dataDir),
        message: "Mock: sesión sintética OK (no real).",
      };
    },
    async listAreaProjects() {
      return [...state.projects];
    },
    async listTaskLabels() {
      return [...state.tasks];
    },
    async listTransportLabels() {
      return [...state.transports];
    },
    async listReportsForDate(dateYmd) {
      return (state.existing[dateYmd] ?? []).map(r => ({ ...r, dateYmd }));
    },
    async applyUiAction(action) {
      if (state.pending) {
        return { ok: false, message: "FAIL_CLOSED: UI incierta/pending; reconciliar antes de reintentar." };
      }
      const list = (state.existing[action.dateYmd] ??= []);
      if (action.op === "create") {
        const id = `mock-${state.nextId++}`;
        const hours = Number(action.fields?.hours ?? 0);
        list.push({ id, hours, summary: action.fields?.notes });
        return { ok: true, message: "Mock create OK", reportId: id };
      }
      if (action.op === "update") {
        const row = list.find((r) => r.id === action.reportId);
        if (!row) return { ok: false, message: "Mock: reportId no encontrado" };
        if (action.fields?.hours) row.hours = Number(action.fields.hours);
        if (action.fields?.notes) row.summary = action.fields.notes;
        return { ok: true, message: "Mock update OK", reportId: row.id };
      }
      // delete
      const before = list.length;
      state.existing[action.dateYmd] = list.filter((r) => r.id !== action.reportId);
      if (state.existing[action.dateYmd].length === before) {
        return { ok: false, message: "Mock: nada que borrar" };
      }
      return { ok: true, message: "Mock delete OK", reportId: action.reportId };
    },
  };
}
