/**
 * UN perfil de navegador para todo Linky (Google, Ripor, Google Chat, Azure web), fuera del repo.
 * La persona inicia sesión en Google una vez; Ripor ("Iniciar con Google") y Chat reutilizan esa sesión,
 * así que los re-logins pueden hacerse en headless sin abrir ventanas. Cookies cifradas por el SO (perfil Chrome).
 */
import { access, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";

export function sharedBrowserProfileDir(dataDir?: string): string {
  return path.join(linkyDataDir(dataDir), "browser-profiles", "linky");
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Migra el perfil anterior de Google Chat (si existe) al perfil compartido. */
async function migrateLegacyProfile(dataDir?: string): Promise<void> {
  const shared = sharedBrowserProfileDir(dataDir);
  const legacy = path.join(linkyDataDir(dataDir), "browser-profiles", "google-chat");
  if (!(await exists(shared)) && (await exists(legacy))) await rename(legacy, shared).catch(() => undefined);
}

export async function openSharedBrowser(opts: { headless: boolean; dataDir?: string; channel?: string }) {
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error("playwright-core no está instalado (dependencia opcional). Ejecuta `npm install`.");
  }
  await migrateLegacyProfile(opts.dataDir);
  const dir = sharedBrowserProfileDir(opts.dataDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // Chrome → Edge → Chromium de Playwright (Linux sin Chrome: `npx playwright-core install chromium`).
  const channels: Array<string | undefined> = opts.channel ? [opts.channel] : ["chrome", "msedge", undefined];
  let lastError: unknown;
  for (const channel of channels) {
    try {
      return await pw.chromium.launchPersistentContext(dir, {
        headless: opts.headless,
        channel,
        viewport: opts.headless ? { width: 1366, height: 900 } : null,
        // Google/Microsoft bloquean el login si ven el flag de automatización.
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled"],
      });
    } catch (e) {
      lastError = e;
      if (/ProcessSingleton|already in use|SingletonLock/i.test(String((e as Error)?.message))) {
        throw new Error("El navegador de Linky ya está abierto (otro login en curso). Ciérralo y repite.");
      }
    }
  }
  throw new Error(
    `No se pudo abrir Chrome/Edge ni Chromium (${String((lastError as Error)?.message ?? lastError).split("\n")[0]}). ` +
      "Instala Google Chrome o ejecuta: npx playwright-core install chromium",
  );
}

/**
 * Error de navegador SIN registros de llamada: Playwright adjunta cabeceras (incluidas cookies de sesión)
 * a sus errores de red. Nunca propagar ni imprimir esos registros.
 */
export function safeBrowserError(e: unknown, context: string): Error {
  const first = String((e as Error)?.message ?? e).split("\n")[0].replace(/cookie:.*$/i, "[cookies omitidas]");
  return new Error(`${context}: ${first.slice(0, 200)}`);
}
