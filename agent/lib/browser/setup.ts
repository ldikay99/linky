import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";
import { riporBrowserProfileDir } from "./paths.js";

/** Generates instructions/config only. Never spawns npx, installs, starts a browser, or edits client settings. */
export function browserSetupPlan(dataDir?: string) {
  const dir = linkyDataDir(path.join(linkyDataDir(dataDir), "browser-setup"));
  const profileDir = riporBrowserProfileDir(dataDir);
  const outputDir = linkyDataDir(path.join(linkyDataDir(dataDir), "browser-output"));
  const runtimeConfig = {
    browser: { browserName: "chromium", userDataDir: profileDir, launchOptions: { channel: "chromium", headless: false } },
    capabilities: ["core"],
    saveSession: false,
    webmcp: false,
    codegen: "none",
    console: { level: "error" },
    outputDir,
    redactUrlParams: ["access_token", "refresh_token", "token", "code"],
  };
  // Official generic mcpServers format. VS Code and TOML clients require adapting the outer shape.
  const server = {
    command: "npx",
    args: ["-y", "@playwright/mcp@latest", "--config", path.join(dir, "playwright-headed.json")],
  };
  return {
    dir, profileDir, outputDir, runtimeConfig,
    genericConfig: { mcpServers: { "linky-ripor": server } },
    vscodeConfig: { servers: { "linky-ripor": { type: "stdio", ...server } } },
    manualInstall: [
      "En el dispositivo destinatario: Node 24 (Linky), cliente MCP con stdio y acceso a pantalla para primer login.",
      "Importar MANUALMENTE uno de los archivos generados en la configuración del cliente; no habilitar ambos.",
      "Al iniciar el servidor, npx descarga/ejecuta @playwright/mcp@latest de npm (revisar/pinear versión antes de uso estable).",
      "Si falta Chromium: ejecutar explícitamente en ese dispositivo: npx playwright install chromium (versión compatible con el MCP elegido).",
      "No instala dependencias OS; si faltan, revisar documentación antes de cualquier install-deps con privilegios.",
    ],
    caveats: [
      "No se instaló ni arrancó nada. No se modificó ninguna configuración del cliente actual.",
      "latest es móvil: tras probar, fijar versión MCP y Playwright compatibles en la copia local del cliente.",
      "Persistencia no es login eterno: MFA, expiración, revocación y políticas del sitio pueden exigir login otra vez.",
      "Un solo navegador usa este perfil a la vez. Cerrar/parar el servidor antes de cambiar modo o cliente.",
      "Headless es configuración de arranque, no cambio garantizado en caliente; requerirá reiniciar con el mismo perfil.",
      "El perfil contiene estado autenticado administrado por el navegador: privado, no sincronizar/zip/exportar ni leer con Linky.",
      "Core MCP puede exponer herramientas peligrosas: el cliente DEBE bloquear evaluate/run_code/network/storage; Linky usa una allowlist adicional.",
      "La configuración MCP de Grok Bot no se exporta: solo el servidor npm estándar y la skill son portables.",
    ],
  };
}

export async function writeBrowserSetup(dataDir?: string) {
  const plan = browserSetupPlan(dataDir);
  await mkdir(plan.dir, { recursive: true, mode: 0o700 });
  const files: Record<string, unknown> = {
    "playwright-headed.json": plan.runtimeConfig,
    "playwright-headless.json": {
      ...plan.runtimeConfig,
      browser: { ...plan.runtimeConfig.browser, launchOptions: { channel: "chromium", headless: true } },
    },
    "mcp.generic.json": plan.genericConfig,
    "mcp.vscode.json": plan.vscodeConfig,
  };
  // No silent replacement of a previously reviewed configuration.
  for (const name of Object.keys(files)) {
    try { await access(path.join(plan.dir, name)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; }
    throw new Error("Browser setup already exists; inspect it before regenerating (nothing overwritten).");
  }
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(plan.dir, name), JSON.stringify(body, null, 2), { mode: 0o600, flag: "wx" });
  }
  return { ...plan, generatedFiles: Object.keys(files).map(n => path.join(plan.dir, n)), installed: false, connected: false };
}

/** Only reads Linky's own generated config; never inspects browser state or credential files. */
export async function browserSetupStatus(dataDir?: string) {
  const plan = browserSetupPlan(dataDir);
  let generated = false;
  try { await readFile(path.join(plan.dir, "mcp.generic.json"), "utf8"); generated = true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  return {
    generated, profileDir: plan.profileDir, configDir: plan.dir,
    session: "unknown (no browser contacted)", runtimeVerified: false,
    headlessReuseVerified: false, liveMutationsSupported: false,
    next: generated ? "Import config manually into a local MCP stdio client; read docs/BROWSER-MCP.md" : "Run browser setup",
  };
}
