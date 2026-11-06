/** Cliente Azure DevOps REST — interfaz + HTTP + mock. Sin escrituras reales en tests. */
import type { FieldMeta, PermissionProbeResult, ProcessMeta, StateMeta } from "../types.js";
import { SAFE_FETCH_REDIRECT, validateOrganizationUrl } from "../security/orgUrl.js";
import { attachmentRelationPatch, CLIENT_KEY_MARKER_PREFIX, clientKeyToken } from "./attachments.js";

export type AzureAuth = {
  organizationUrl: string;
  project: string;
  /** PAT (preferido). */
  pat?: string;
  /** Alternativa: header Cookie de la sesión web (azure login). Nunca se persiste fuera del keyring. */
  cookie?: string;
};

export class AzureSessionExpiredError extends Error {
  constructor(detail: string) {
    super(`AZURE_AUTH_INVALID: ${detail}. Revisa el PAT o inicia sesión de nuevo: npm run linky -- azure login`);
    this.name = "AzureSessionExpiredError";
  }
}

/** Headers de autenticación: PAT (Basic) o cookie de sesión web sin redirección a login. */
export function azureAuthHeaders(auth: Pick<AzureAuth, "pat" | "cookie">): Record<string, string> {
  if (auth.pat) return { Authorization: `Basic ${Buffer.from(`:${auth.pat}`).toString("base64")}` };
  if (auth.cookie) {
    return {
      cookie: auth.cookie,
      "X-TFS-FedAuthRedirect": "Suppress",
      "X-VSS-ReauthenticationAction": "Suppress",
    };
  }
  throw new Error("Azure: falta PAT o sesión web (azure login).");
}

/** Sin auth válida Azure responde 203/HTML de login o 401/302. */
export function assertAzureAuthenticated(res: Response): void {
  const ct = res.headers.get("content-type") ?? "";
  if (res.status === 401 || (res.status >= 300 && res.status < 400) || (res.status === 203 && /html/i.test(ct))) {
    throw new AzureSessionExpiredError(`HTTP ${res.status}`);
  }
}

export type WorkItem = {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  url?: string;
  relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
};

export type AttachmentUploadResult = {
  id: string;
  url: string;
  fileName: string;
};

export type JsonPatch = Array<{ op: string; path: string; value: unknown }>;

export type AzureClient = {
  probePermissions(): Promise<PermissionProbeResult>;
  getWorkItemTypeFields(typeName: string): Promise<FieldMeta[]>;
  getWorkItemTypeStates(typeName: string): Promise<StateMeta[]>;
  getProcessMeta(typeName: string): Promise<ProcessMeta>;
  getWorkItem(id: number): Promise<WorkItem>;
  createWorkItem(typeName: string, patch: JsonPatch): Promise<WorkItem>;
  updateWorkItem(id: number, patch: JsonPatch, opts?: { ifMatchRev?: number }): Promise<WorkItem>;
  uploadAttachment(fileName: string, contentType: string, bytes: Uint8Array): Promise<AttachmentUploadResult>;
  queryByClientKeyMarker(clientKey: string): Promise<number[]>;
};

export function createHttpAzureClient(auth: AzureAuth, fetchImpl: typeof fetch = fetch): AzureClient {
  const validated = validateOrganizationUrl(auth.organizationUrl);
  const base = validated.organizationUrl;
  const project = encodeURIComponent(auth.project);
  const authHeaders = azureAuthHeaders(auth);

  async function api(path: string, init?: RequestInit & { rawBody?: Uint8Array | string; contentType?: string }): Promise<Response> {
    const url = `${base}${path}`;
    const headers: Record<string, string> = {
      ...authHeaders,
      Accept: "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (init?.contentType) headers["Content-Type"] = init.contentType;
    else if (!headers["Content-Type"] && init?.body && typeof init.body === "string") {
      headers["Content-Type"] = "application/json";
    }

    const body: BodyInit | null | undefined = init?.rawBody
      ? Buffer.from(init.rawBody)
      : (init?.body as BodyInit | null | undefined);
    const res = await fetchImpl(url, {
      method: init?.method,
      headers,
      body,
      redirect: SAFE_FETCH_REDIRECT,
      signal: init?.signal,
    });
    if (!auth.pat) assertAzureAuthenticated(res);
    return res;
  }

  return {
    async probePermissions() {
      const notes: string[] = [];
      let canRead = false;
      const projRes = await api(`/${project}/_apis/wit/workitemtypes?api-version=7.1`);
      if (projRes.ok) {
        canRead = true;
        notes.push("Lectura de tipos de work item OK.");
      } else {
        notes.push(`No se pudo leer tipos (HTTP ${projRes.status}). Revisa PAT y scopes.`);
      }
      notes.push("Linky no prueba escrituras automáticamente.");
      notes.push("canCreate/Update/ChangeState quedan en false hasta un apply autorizado.");
      return {
        canRead,
        canCreateWorkItems: false,
        canUpdateWorkItems: false,
        canChangeState: false,
        notes,
      };
    },

    async getWorkItemTypeFields(typeName) {
      const t = encodeURIComponent(typeName);
      const res = await api(`/${project}/_apis/wit/workitemtypes/${t}/fields?$expand=allowedValues&api-version=7.1`);
      if (!res.ok) throw new Error(`fields HTTP ${res.status}`);
      const data = (await res.json()) as { value: Array<Record<string, unknown>> };
      return (data.value || []).map((f) => ({
        referenceName: String(f.referenceName || f.name),
        name: String(f.name || f.referenceName),
        type: String(f.type || "string"),
        required: Boolean(f.alwaysRequired),
        readOnly: Boolean(f.readOnly),
        allowedValues: Array.isArray(f.allowedValues) && f.allowedValues.length ? f.allowedValues.map(String) : undefined,
        defaultValue: f.defaultValue ?? undefined,
      }));
    },

    async getWorkItemTypeStates(typeName) {
      const t = encodeURIComponent(typeName);
      const res = await api(`/${project}/_apis/wit/workitemtypes/${t}/states?api-version=7.1`);
      if (!res.ok) throw new Error(`states HTTP ${res.status}`);
      const data = (await res.json()) as { value: Array<Record<string, unknown>> };
      return (data.value || []).map((s) => ({
        name: String(s.name),
        category: s.category ? String(s.category) : undefined,
      }));
    },

    async getProcessMeta(typeName) {
      const [fields, states] = await Promise.all([
        this.getWorkItemTypeFields(typeName),
        this.getWorkItemTypeStates(typeName),
      ]);
      return { workItemType: typeName, fields, states, transitions: [] };
    },

    async getWorkItem(id) {
      const res = await api(`/${project}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`);
      if (!res.ok) throw new Error(`getWorkItem HTTP ${res.status}`);
      return (await res.json()) as WorkItem;
    },

    async createWorkItem(typeName, patch) {
      const t = encodeURIComponent(typeName);
      const res = await api(`/${project}/_apis/wit/workitems/$${t}?api-version=7.1`, {
        method: "POST",
        contentType: "application/json-patch+json",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`createWorkItem HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as WorkItem;
    },

    async updateWorkItem(id, patch, opts) {
      const headers: Record<string, string> = {};
      if (opts?.ifMatchRev != null) headers["If-Match"] = String(opts.ifMatchRev);
      const res = await api(`/${project}/_apis/wit/workitems/${id}?api-version=7.1`, {
        method: "PATCH",
        contentType: "application/json-patch+json",
        body: JSON.stringify(patch),
        headers,
      });
      if (!res.ok) throw new Error(`updateWorkItem HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as WorkItem;
    },

    async uploadAttachment(fileName, contentType, bytes) {
      const q = new URLSearchParams({ fileName, api_version: "7.1" });
      // Azure expects api-version as query param name with hyphen
      const res = await api(
        `/${project}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`,
        {
          method: "POST",
          contentType: contentType || "application/octet-stream",
          rawBody: bytes,
        },
      );
      void q;
      if (!res.ok) throw new Error(`uploadAttachment HTTP ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { id: string; url: string };
      return { id: data.id, url: data.url, fileName };
    },

    async queryByClientKeyMarker(clientKey) {
      const marker = `${CLIENT_KEY_MARKER_PREFIX}${clientKeyToken(clientKey)}`;
      const wiql = {
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.Description] CONTAINS '${marker.replace(/'/g, "''")}'`,
      };
      const res = await api(`/${project}/_apis/wit/wiql?api-version=7.1`, {
        method: "POST",
        body: JSON.stringify(wiql),
      });
      if (!res.ok) throw new Error(`wiql HTTP ${res.status}`);
      const data = (await res.json()) as { workItems?: Array<{ id: number }> };
      return (data.workItems || []).map((w) => w.id);
    },
  };
}

export type MockAzureState = {
  nextId: number;
  attachmentId: number;
  items: Map<number, WorkItem>;
  attachments: Map<string, { fileName: string; contentType: string; bytes: Uint8Array; url: string }>;
  types: Record<string, ProcessMeta>;
  /** Simula: crea el WI y luego falla la respuesta (para journal unknown). */
  failAfterCreate?: boolean;
  createCallCount: number;
  lastUpload?: { fileName: string; contentType: string; byteLength: number; bytes: Uint8Array };
};

export function createMockAzureClient(seed?: Partial<MockAzureState>): { client: AzureClient; state: MockAzureState } {
  const state: MockAzureState = {
    nextId: seed?.nextId ?? 900001,
    attachmentId: seed?.attachmentId ?? 1,
    items: seed?.items ?? new Map(),
    attachments: seed?.attachments ?? new Map(),
    createCallCount: 0,
    failAfterCreate: seed?.failAfterCreate ?? false,
    types: seed?.types ?? {
      Task: {
        workItemType: "Task",
        fields: [
          { referenceName: "System.Title", name: "Title", type: "string", required: true, readOnly: false },
          { referenceName: "System.Description", name: "Description", type: "html", required: false, readOnly: false },
          { referenceName: "System.Tags", name: "Tags", type: "string", required: false, readOnly: false },
          { referenceName: "System.AssignedTo", name: "Assigned To", type: "string", required: false, readOnly: false },
          { referenceName: "System.State", name: "State", type: "string", required: false, readOnly: false },
          { referenceName: "System.History", name: "History", type: "history", required: false, readOnly: false },
          { referenceName: "Microsoft.VSTS.Common.Activity", name: "Activity", type: "string", required: false, readOnly: false },
          { referenceName: "Microsoft.VSTS.Scheduling.CompletedWork", name: "Completed Work", type: "double", required: false, readOnly: false },
          { referenceName: "Custom.SubActividad", name: "SubActividad", type: "string", required: false, readOnly: false },
          { referenceName: "Custom.TicketAsociado", name: "Ticket Asociado", type: "string", required: false, readOnly: false },
          { referenceName: "Custom.FechadeEntregaReal", name: "Fecha de Entrega Real", type: "dateTime", required: false, readOnly: false },
        ],
        states: [
          { name: "To Do", category: "Proposed" },
          { name: "In Progress", category: "InProgress" },
          { name: "Entregado", category: "Resolved" },
          { name: "Done", category: "Completed" },
          { name: "Closed", category: "Completed" },
        ],
        transitions: [
          { from: "To Do", to: "In Progress" },
          { from: "In Progress", to: "Entregado" },
          { from: "Entregado", to: "Closed" },
          { from: "In Progress", to: "Done" },
        ],
      },
      "User Story": {
        workItemType: "User Story",
        fields: [
          { referenceName: "System.Title", name: "Title", type: "string", required: true, readOnly: false },
          { referenceName: "System.Description", name: "Description", type: "html", required: false, readOnly: false },
          { referenceName: "System.Tags", name: "Tags", type: "string", required: false, readOnly: false },
          { referenceName: "System.State", name: "State", type: "string", required: false, readOnly: false },
        ],
        states: [
          { name: "New", category: "Proposed" },
          { name: "Active", category: "InProgress" },
          { name: "Resolved", category: "Resolved" },
          { name: "Closed", category: "Completed" },
        ],
        transitions: [
          { from: "New", to: "Active" },
          { from: "Active", to: "Resolved" },
          { from: "Resolved", to: "Closed" },
        ],
      },
    },
  };

  function applyPatch(item: WorkItem, patch: JsonPatch) {
    if (!item.relations) item.relations = [];
    for (const p of patch) {
      if (p.path.startsWith("/fields/")) {
        item.fields[p.path.slice("/fields/".length)] = p.value;
      } else if (p.path === "/relations/-") {
        const rel = p.value as { rel: string; url: string; attributes?: Record<string, unknown> };
        item.relations.push(rel);
      }
    }
    item.rev += 1;
  }

  const client: AzureClient = {
    async probePermissions() {
      return {
        canRead: true,
        canCreateWorkItems: true,
        canUpdateWorkItems: true,
        canChangeState: true,
        notes: ["Mock: permisos simulados OK. No es Azure real."],
      };
    },
    async getWorkItemTypeFields(typeName) {
      return (await this.getProcessMeta(typeName)).fields;
    },
    async getWorkItemTypeStates(typeName) {
      return (await this.getProcessMeta(typeName)).states;
    },
    async getProcessMeta(typeName) {
      const meta = state.types[typeName];
      if (!meta) throw new Error(`Tipo desconocido en mock: ${typeName}`);
      return meta;
    },
    async getWorkItem(id) {
      const item = state.items.get(id);
      if (!item) throw new Error(`Work item ${id} no existe en mock`);
      return structuredClone(item);
    },
    async createWorkItem(typeName, patch) {
      state.createCallCount += 1;
      const fields: Record<string, unknown> = {
        "System.WorkItemType": typeName,
        "System.State": typeName === "Task" ? "To Do" : "New",
        "System.TeamProject": "Example Project",
      };
      const item: WorkItem = { id: state.nextId++, rev: 0, fields, url: `mock://workitems/`, relations: [] };
      applyPatch(item, patch);
      item.url = `mock://workitems/${item.id}`;
      state.items.set(item.id, item);
      if (state.failAfterCreate) {
        throw new Error("SIMULATED_RESPONSE_LOSS: el servidor pudo crear el ítem pero la respuesta falló");
      }
      return structuredClone(item);
    },
    async updateWorkItem(id, patch, opts) {
      const item = state.items.get(id);
      if (!item) throw new Error(`Work item ${id} no existe`);
      if (opts?.ifMatchRev != null && opts.ifMatchRev !== item.rev) {
        throw new Error(`updateWorkItem HTTP 412: rev mismatch (expected ${opts.ifMatchRev}, actual ${item.rev})`);
      }
      applyPatch(item, patch);
      return structuredClone(item);
    },
    async uploadAttachment(fileName, contentType, bytes) {
      const id = `att-${state.attachmentId++}`;
      const url = `mock://attachments/${id}`;
      const copy = new Uint8Array(bytes);
      state.attachments.set(id, { fileName, contentType, bytes: copy, url });
      state.lastUpload = { fileName, contentType, byteLength: bytes.byteLength, bytes: copy };
      return { id, url, fileName };
    },
    async queryByClientKeyMarker(clientKey) {
      const needle = `${CLIENT_KEY_MARKER_PREFIX}${clientKeyToken(clientKey)}`;
      const ids: number[] = [];
      for (const [id, item] of state.items) {
        const desc = String(item.fields["System.Description"] ?? "");
        if (desc.includes(needle)) ids.push(id);
      }
      return ids;
    },
  };

  return { client, state };
}

export { attachmentRelationPatch };
