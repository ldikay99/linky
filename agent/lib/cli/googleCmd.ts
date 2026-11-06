/**
 * Sesión de Google del perfil compartido de Linky (Chat, Calendar, login de Ripor con Google).
 * logout invalida la sesión en los servidores de Google (sirve para rotarla); login la crea de nuevo.
 */
import { openSharedBrowser } from "../browser/shared.js";
import { waitForLogin } from "../browser/launch.js";
import { hasGoogleSession } from "../chat/browser.js";
import type { argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

function print(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

export async function runGoogleCommand(sub: string | undefined, a: Argv, dataDir?: string): Promise<void> {
  if (sub === "status") {
    const ctx = await openSharedBrowser({ headless: true, dataDir });
    try {
      print({ googleSession: await hasGoogleSession(ctx) });
    } finally {
      await ctx.close().catch(() => undefined);
    }
    return;
  }

  if (sub === "logout") {
    const ctx = await openSharedBrowser({ headless: true, dataDir });
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto("https://accounts.google.com/Logout", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(3000);
      print({ ok: !(await hasGoogleSession(ctx)), message: "Sesión de Google del perfil de Linky cerrada (cookies invalidadas en Google)." });
    } finally {
      await ctx.close().catch(() => undefined);
    }
    return;
  }

  if (sub === "login") {
    const ctx = await openSharedBrowser({ headless: false, dataDir, channel: a.arg("--channel") });
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      if (!(await hasGoogleSession(ctx))) {
        await page.goto("https://accounts.google.com/ServiceLogin?continue=" + encodeURIComponent("https://myaccount.google.com/"));
        process.stderr.write("Inicia sesión en Google en la ventana. Se cerrará sola al detectar la sesión.\n");
        await waitForLogin(
          () => ctx.pages().length > 0,
          async () => ((await hasGoogleSession(ctx)) && new URL(page.url()).hostname === "myaccount.google.com" ? true : undefined),
        );
      }
      print({ ok: true, googleSession: true });
    } finally {
      await ctx.close().catch(() => undefined);
    }
    return;
  }

  console.log(`linky google <login|logout|status>
  login    navegador visible: inicias sesión en Google una vez (Chat, Calendar y Ripor con Google)
  logout   cierra e invalida la sesión de Google del perfil de Linky (rotación)
  status   ¿hay sesión de Google en el perfil de Linky?`);
  if (sub) process.exitCode = 1;
}
