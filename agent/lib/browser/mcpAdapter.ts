import type { RiporUiAdapter } from "./adapter.js";
import { defaultBrowserCapabilities } from "./capabilities.js";
import { riporBrowserProfileDir } from "./paths.js";
import { RIPOR_PUBLIC_URL } from "../ripor/types.js";

/** Structural subset of the PUBLIC MCP Client SDK. Inject an already-authorized client.
 * No transport/browser is started here; client.listTools/callTool are the official MCP interface.
 */
export interface PublicMcpClient {
  listTools(): Promise<{ tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> }>;
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<{
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  }>;
}
const ALLOWED = new Set(["browser_navigate", "browser_snapshot", "browser_click"]);
export type SnapshotNode = { role: string; name: string; ref?: string };

/** Recognize MCP accessibility snapshot nodes only. Text outside this shape is never executable. */
export function snapshotNodes(text: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*-\s+(\w+)(?:\s+"([^"\n]*)")?[^\n]*?\[ref=([\w-]+)\]/u.exec(line);
    if (match) nodes.push({ role: match[1]!, name: match[2] ?? "", ref: match[3] });
  }
  return nodes;
}

function snapshotUrl(text: string): string | undefined {
  const match = /^- Page URL:\s*(\S+)\s*$/m.exec(text);
  return match?.[1];
}
function exactPublicPage(text: string) {
  const url = snapshotUrl(text);
  return url === RIPOR_PUBLIC_URL || url === RIPOR_PUBLIC_URL + "/";
}

export function observeLoginStatus(text: string): "authenticated" | "needs_login" | "unknown" {
  const nodes = snapshotNodes(text);
  if (nodes.some(n => /^(?:iniciar sesi[oó]n|sign in|log in|continuar con google)$/i.test(n.name))) {
    return "needs_login";
  }
  if (!exactPublicPage(text)) return "unknown";
  const hasRegistrar = nodes.some(n => n.role === "button" && n.name === "Registrar");
  const hasActivityContext = nodes.some(n => n.role === "heading" && /horas|actividad/i.test(n.name));
  // Positive, conservative UI markers only — a URL alone is NOT authenticated.
  return hasRegistrar && hasActivityContext ? "authenticated" : "unknown";
}

export function createPlaywrightMcpRiporAdapter(client: PublicMcpClient): RiporUiAdapter & {
  /** Explicit read-navigation, never login clicks. */
  openPublicPage(): Promise<{ status: "authenticated" | "needs_login" | "unknown" }>;
  observeForm(): Promise<{ nodes: SnapshotNode[]; status: string }>;
  observeOptions(kind: "areaProject" | "task" | "transport"): Promise<string[]>;
} {
  let discovered: Awaited<ReturnType<PublicMcpClient["listTools"]>>["tools"] | undefined;

  async function call(name: string, args: Record<string, unknown>): Promise<string> {
    if (!ALLOWED.has(name)) throw new Error("MCP tool rejected by Linky allowlist");
    discovered = (await client.listTools()).tools;
    const tool = discovered.find(t => t.name === name);
    if (!tool) throw new Error(`MCP tool unavailable: ${name}. No unsafe fallback.`);
    const properties = tool.inputSchema?.properties;
    if (!properties) throw new Error(`MCP schema unavailable: ${name}`);
    const result = await client.callTool({ name, arguments: args });
    // Never persist or print external error contents (could contain personal data).
    if (result.isError) throw new Error(`MCP ${name} failed; inspect UI in client, do not retry a save.`);
    return result.content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n");
  }

  async function snapshot() {
    return call("browser_snapshot", {});
  }

  async function clickObservedCombo(node: SnapshotNode) {
    const tools = (await client.listTools()).tools;
    const props = tools.find(t => t.name === "browser_click")?.inputSchema?.properties;
    // Official tool schemas evolved from ref to target; never guess an unsupported parameter.
    const key = props && "target" in props ? "target" : props && "ref" in props ? "ref" : undefined;
    if (!key || !node.ref) throw new Error("Unsupported MCP click schema; no action taken.");
    await call("browser_click", { [key]: node.ref, element: `Open ${node.role} ${node.name}` });
  }

  async function options(kind: "areaProject" | "task" | "transport") {
    const text = await snapshot();
    if (!exactPublicPage(text)) throw new Error("Ripor public page not confirmed; no dropdown opened.");
    const candidates = snapshotNodes(text).filter(n => n.role === "combobox" && (
      kind === "transport" ? /^(Seleccionar medio de transporte|Medio de transporte)$/i.test(n.name)
      : kind === "task" ? /^(Selecciona las tareas|Tarea Personalizada|Tareas)$/i.test(n.name)
      : /^(Ingresa el proyecto|Proyecto)$/i.test(n.name)
    ));
    if (candidates.length !== 1) {
      throw new Error(`Ambiguous/unlabelled ${kind} control. AI must re-snapshot containing label and open the correct dropdown; no guessed click.`);
    }
    await clickObservedCombo(candidates[0]!);
    const fresh = await snapshot();
    if (!exactPublicPage(fresh)) throw new Error("Page changed while observing dropdown.");
    // Require one visible listbox and scope options to its indented subtree.
    // Flat/global option scraping could silently mix task and transport choices.
    const lines = fresh.split("\n");
    const listboxes = lines.map((line, index) => ({ line, index }))
      .filter(({ line }) => /^\s*- listbox(?:\s|\[|:|$)/.test(line));
    if (listboxes.length !== 1) throw new Error("Dropdown listbox missing/ambiguous; no global option scraping.");
    const start = listboxes[0]!;
    const indent = start.line.search(/\S/);
    const subtree: string[] = [];
    for (const line of lines.slice(start.index + 1)) {
      if (/^\s*- /.test(line) && line.search(/\S/) <= indent) break;
      if (line.startsWith("```")) break;
      subtree.push(line);
    }
    const names = snapshotNodes(subtree.join("\n")).filter(n => n.role === "option").map(n => n.name).filter(Boolean);
    if (!names.length || new Set(names).size !== names.length) {
      throw new Error("Options missing/ambiguous in fresh snapshot; no invented options returned.");
    }
    return names;
  }

  return {
    kind: "playwright_mcp",
    capabilities: defaultBrowserCapabilities({
      notes: [
        "Public MCP client injected. Navigate/snapshot/dropdown observation implemented; not live-verified here.",
        "Headed/headless/profile configuration belongs to the recipient MCP client; no runtime mode assumed.",
        "Manual UI cycle observed by parent; automatic report parser, submit, confirmations and reconciliation NOT implemented/validated; automated mutations disabled.",
      ],
    }),
    async openPublicPage() {
      await call("browser_navigate", { url: RIPOR_PUBLIC_URL });
      return { status: observeLoginStatus(await snapshot()) };
    },
    async ensureSession({ dataDir }) {
      const status = observeLoginStatus(await snapshot());
      return {
        status, profileDir: riporBrowserProfileDir(dataDir),
        message: status === "needs_login"
          ? "Manual login required in dedicated headed browser. AI must not request/export passwords or storage."
          : status === "authenticated" ? "Positive UI markers observed for this session only; persistence not tested."
          : "UI authentication unknown; inspect fresh snapshot. Do not assume a session or auto-login.",
      };
    },
    async observeForm() {
      const text = await snapshot();
      if (!exactPublicPage(text)) throw new Error("Ripor public page not confirmed.");
      return { nodes: snapshotNodes(text), status: observeLoginStatus(text) };
    },
    observeOptions: options,
    listAreaProjects: () => options("areaProject"),
    listTaskLabels: () => options("task"),
    listTransportLabels: () => options("transport"),
    async listReportsForDate() {
      throw new Error("LIVE_REPORT_PARSER_UNVERIFIED: AI must observe complete dated rows/IDs/hours and validate deterministic preview; cannot infer an empty day.");
    },
    async applyUiAction() {
      throw new Error("LIVE_MUTATION_UNVERIFIED: manual UI cycle verified, but automatic selectors, save/delete and reconciliation adapter NOT implemented/validated. No click submitted. Use guided skill with explicit per-action approval, not mock apply.");
    },
  };
}
