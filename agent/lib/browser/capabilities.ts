/**
 * Flags honestas del runtime Playwright/MCP.
 * Nunca afirmar headless/producción si no está comprobado.
 */
export type BrowserCapabilities = {
  /** Herramientas MCP Playwright disponibles en este host. */
  playwrightMcpAvailable: boolean;
  /** Headed (UI visible) soportado para login manual. */
  headedLoginSupported: boolean;
  /** Headless reutilizando perfil — solo true si runtime lo confirma. */
  headlessReuseSupported: boolean;
  /** Este proceso puede navegar ahora (este subagente normalmente NO). */
  canNavigateInThisProcess: boolean;
  notes: string[];
};

/** Default seguro: no fingir producción real. */
export function defaultBrowserCapabilities(
  overrides?: Partial<BrowserCapabilities>,
): BrowserCapabilities {
  return {
    playwrightMcpAvailable: false,
    headedLoginSupported: false,
    headlessReuseSupported: false,
    canNavigateInThisProcess: false,
    notes: [
      "Navegación real solo vía herramientas Playwright autorizadas del host (no Shell).",
      "Headless/headed: no marcar como operativo hasta comprobar el conector en el dispositivo del usuario.",
      "No extraer ni persistir cookies/tokens/passwords en el repo ni en el perfil JSON de Linky.",
    ],
    ...overrides,
  };
}
