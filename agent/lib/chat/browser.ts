/**
 * Google Chat vía navegador (Google no ofrece API de usuario sin proyecto Cloud/OAuth propio).
 * Usa el perfil compartido de Linky: login visible una vez; después todo headless.
 */
import { openSharedBrowser } from "../browser/shared.js";

export const GOOGLE_SIGNIN_TO_CHAT =
  "https://accounts.google.com/ServiceLogin?continue=" + encodeURIComponent("https://mail.google.com/chat/u/0/");

/** URL de una conversación (espacio o DM) en Chat standalone, Chat en Gmail o Gmail con Chat integrado. */
export function isConversationUrl(url: string): boolean {
  return (
    /^https:\/\/chat\.google\.com\/(?:u\/\d+\/)?(?:app\/)?(?:chat|room|dm)\/[\w-]+/.test(url) ||
    /^https:\/\/mail\.google\.com\/(?:chat|mail)\/u\/\d+\/[^#]*#chat\/(?:space|dm)\/[\w-]+/.test(url)
  );
}

/** ¿Hay sesión de Google en el perfil? (cookies de cuenta en .google.com) */
export async function hasGoogleSession(context: import("playwright-core").BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://accounts.google.com");
  return cookies.some((c) => c.name === "SID" || c.name === "__Secure-1PSID");
}

/**
 * Login + elección del chat: la persona inicia sesión, abre el chat donde reporta y cierra la ventana.
 * Devuelve la última conversación abierta (y las URLs vistas, sin parámetros, para diagnóstico).
 */
export async function loginAndPickChat(opts?: { dataDir?: string; channel?: string; log?: (m: string) => void }) {
  const log = opts?.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const context = await openSharedBrowser({ headless: false, dataDir: opts?.dataDir, channel: opts?.channel });
  const page = context.pages()[0] ?? (await context.newPage());
  let lastConversation: { url: string; title: string } | undefined;
  const seen = new Set<string>();
  const track = async () => {
    for (const p of context.pages()) {
      const url = p.url();
      seen.add(url.split("?")[0]);
      if (isConversationUrl(url)) lastConversation = { url, title: await p.title().catch(() => "") };
    }
  };
  const signedIn = await hasGoogleSession(context);
  await page.goto(signedIn ? "https://mail.google.com/chat/u/0/" : GOOGLE_SIGNIN_TO_CHAT);
  log(
    (signedIn ? "Sesión de Google detectada. " : "Inicia sesión en Google. ") +
      "Abre el chat donde se reporta el día y CIERRA la ventana cuando estés dentro de él.",
  );
  const timer = setInterval(() => void track(), 1000);
  await new Promise<void>((resolve) => {
    const deadline = setTimeout(() => void context.close().catch(() => undefined), 15 * 60_000);
    context.on("close", () => {
      clearTimeout(deadline);
      resolve();
    });
  });
  clearInterval(timer);
  return { conversation: lastConversation, visited: [...seen].filter((u) => /google\.com/.test(u)).slice(-8) };
}
