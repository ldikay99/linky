/**
 * Login visual Ripor (una vez, o cuando la sesión vence).
 * Al detectar la sesión, solo las cookies de auth pasan al keyring y el navegador se cierra.
 */
import { launchVisibleBrowser, waitForLogin } from "../../browser/launch.js";
import { RIPOR_PUBLIC_URL } from "../types.js";
import { isAuthCookieName, RIPOR_ORIGIN, type RiporCookieJar } from "./session.js";

export async function loginRiporWithBrowser(opts?: {
  timeoutMs?: number;
  channel?: string;
  log?: (msg: string) => void;
}): Promise<RiporCookieJar> {
  const log = opts?.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const vb = await launchVisibleBrowser({ channel: opts?.channel });
  try {
    await vb.page.goto(RIPOR_PUBLIC_URL);
    log("Inicia sesión en la ventana del navegador. Se cerrará sola al detectar la sesión.");
    return await waitForLogin(
      vb,
      async () => {
        const url = new URL(vb.page.url());
        if (url.origin !== RIPOR_ORIGIN || !url.pathname.startsWith("/u/")) return undefined;
        const auth = (await vb.context.cookies(RIPOR_ORIGIN)).filter((c) => isAuthCookieName(c.name));
        return auth.length ? Object.fromEntries(auth.map((c) => [c.name, c.value])) : undefined;
      },
      opts?.timeoutMs,
    );
  } finally {
    await vb.browser.close().catch(() => undefined);
  }
}
