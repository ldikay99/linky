/**
 * Login Ripor con el perfil compartido de Linky.
 * 1) Headless: si el perfil ya tiene sesión de Google, entra con "Google" sin abrir ventana.
 * 2) Si no alcanza, ventana visible para que la persona inicie sesión (una vez).
 * Solo las cookies de auth de ripor.co pasan al keyring.
 */
import { openSharedBrowser } from "../../browser/shared.js";
import { waitForLogin } from "../../browser/launch.js";
import { RIPOR_PUBLIC_URL } from "../types.js";
import { isAuthCookieName, RIPOR_ORIGIN, type RiporCookieJar } from "./session.js";

type Ctx = Awaited<ReturnType<typeof openSharedBrowser>>;

async function riporCookiesIfLoggedIn(context: Ctx): Promise<RiporCookieJar | undefined> {
  const page = context.pages()[0];
  const url = page ? new URL(page.url()) : undefined;
  if (!url || url.origin !== RIPOR_ORIGIN || !url.pathname.startsWith("/u/")) return undefined;
  const auth = (await context.cookies(RIPOR_ORIGIN)).filter((c) => isAuthCookieName(c.name));
  return auth.length ? Object.fromEntries(auth.map((c) => [c.name, c.value])) : undefined;
}

/** Intenta entrar sin intervención: botón "Google" en Ripor y, si Google lo pide, la cuenta ya conectada. */
async function silentLogin(context: Ctx, timeoutMs: number): Promise<RiporCookieJar | undefined> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(RIPOR_PUBLIC_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  let clickedGoogle = false;
  while (Date.now() < deadline) {
    const done = await riporCookiesIfLoggedIn(context);
    if (done) return done;
    const host = new URL(page.url()).hostname;
    if (host === "ripor.co" && !clickedGoogle) {
      const btn = page.getByRole("button", { name: /google/i }).or(page.getByRole("link", { name: /google/i })).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => undefined);
        clickedGoogle = true;
      }
    } else if (host === "accounts.google.com") {
      // Selector de cuenta: elegir la cuenta ya iniciada. Si pide contraseña/2FA, no se puede en silencio.
      const account = page.locator("[data-identifier]").first();
      if (await account.isVisible().catch(() => false)) await account.click().catch(() => undefined);
      if (await page.locator('input[type="password"]').isVisible().catch(() => false)) return undefined;
    }
    await page.waitForTimeout(1000);
  }
  return undefined;
}

export async function loginRiporWithBrowser(opts?: {
  timeoutMs?: number;
  channel?: string;
  dataDir?: string;
  /** Solo intento sin ventana (renovación automática). */
  headlessOnly?: boolean;
  log?: (msg: string) => void;
}): Promise<RiporCookieJar> {
  const log = opts?.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const headless = await openSharedBrowser({ headless: true, dataDir: opts?.dataDir, channel: opts?.channel });
  try {
    const silent = await silentLogin(headless, 30_000);
    if (silent) return silent;
  } finally {
    await headless.close().catch(() => undefined);
  }
  if (opts?.headlessOnly) throw new Error("No se pudo renovar la sesión de Ripor sin ventana. Ejecuta: npm run linky -- ripor login");

  const visible = await openSharedBrowser({ headless: false, dataDir: opts?.dataDir, channel: opts?.channel });
  try {
    const page = visible.pages()[0] ?? (await visible.newPage());
    await page.goto(RIPOR_PUBLIC_URL);
    log("Inicia sesión en Ripor (con Google) en la ventana. Se cerrará sola al detectar la sesión.");
    return await waitForLogin(() => visible.pages().length > 0, () => riporCookiesIfLoggedIn(visible), opts?.timeoutMs);
  } finally {
    await visible.close().catch(() => undefined);
  }
}
