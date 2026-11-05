/**
 * Abre Chrome/Edge INSTALADO en modo visible para que la persona inicie sesión.
 * Contexto efímero: no se escribe perfil ni cookies en disco; quien llama copia
 * solo las cookies necesarias al keyring y cierra el navegador.
 */
export type VisibleBrowser = {
  browser: import("playwright-core").Browser;
  context: import("playwright-core").BrowserContext;
  page: import("playwright-core").Page;
};

export async function launchVisibleBrowser(opts?: { channel?: string }): Promise<VisibleBrowser> {
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error("playwright-core no está instalado (dependencia opcional). Ejecuta `npm install`.");
  }
  // Chrome → Edge → Chromium de Playwright (Linux sin Chrome: `npx playwright-core install chromium`).
  const channels: Array<string | undefined> = opts?.channel ? [opts.channel] : ["chrome", "msedge", undefined];
  let lastError: unknown;
  for (const channel of channels) {
    try {
      const browser = await pw.chromium.launch({
        headless: false,
        channel,
        // Google/Microsoft bloquean el login si ven el flag de automatización.
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--disable-blink-features=AutomationControlled"],
      });
      const context = await browser.newContext({ viewport: null });
      const page = await context.newPage();
      return { browser, context, page };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `No se pudo abrir Chrome/Edge ni Chromium (${String((lastError as Error)?.message ?? lastError).split("\n")[0]}). ` +
      "Instala Google Chrome o ejecuta: npx playwright-core install chromium",
  );
}

/** Espera activa hasta que `check` devuelva un valor o venza el plazo. */
export async function waitForLogin<T>(
  vb: VisibleBrowser,
  check: () => Promise<T | undefined>,
  timeoutMs = 10 * 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!vb.browser.isConnected()) throw new Error("El navegador se cerró antes de completar el login.");
    const v = await check().catch(() => undefined);
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Tiempo de login agotado (${Math.round(timeoutMs / 60_000)} min).`);
}
