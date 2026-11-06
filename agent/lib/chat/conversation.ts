/**
 * Leer y escribir en una conversación de Google Chat (headless, perfil compartido de Linky).
 * La UI de Chat puede vivir en la página o dentro de un iframe de Gmail: se busca en todos los frames.
 */
import type { BrowserContext, Frame, Locator, Page } from "playwright-core";
import { openSharedBrowser } from "../browser/shared.js";
import { hasGoogleSession } from "./browser.js";

const COMPOSER = 'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label]';

async function findComposer(page: Page, timeoutMs: number): Promise<{ frame: Frame; box: Locator }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const box = frame.locator(COMPOSER).last();
      if (await box.isVisible().catch(() => false)) return { frame, box };
    }
    await page.waitForTimeout(500);
  }
  throw new Error("No se encontró el cuadro para escribir en el chat (¿sesión de Google vencida o chat sin permiso?). Ejecuta: npm run linky -- chat login");
}

/** Texto visible de los mensajes recientes (para estilo y verificación). */
async function recentMessages(frame: Frame, limit: number, opts?: { dedupe?: boolean }): Promise<string[]> {
  // Cuerpo del mensaje en Google Chat (jsname estable); respaldo genérico si cambia la UI.
  let texts: string[] = [];
  for (const selector of ['div[jsname="bgckF"]', "[data-message-id] [dir]"]) {
    texts = await frame
      .locator(selector)
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.trim()).filter(Boolean))
      .catch(() => [] as string[]);
    if (texts.length) break;
  }
  const list = opts?.dedupe === false ? texts : texts.filter((t, i) => texts.indexOf(t) === i);
  return list.slice(-limit);
}

async function withConversation<T>(
  url: string,
  fn: (ctx: { page: Page; frame: Frame; box: Locator; context: BrowserContext }) => Promise<T>,
  dataDir?: string,
): Promise<T> {
  const context = await openSharedBrowser({ headless: true, dataDir });
  try {
    if (!(await hasGoogleSession(context))) throw new Error("No hay sesión de Google en el perfil de Linky. Ejecuta: npm run linky -- chat login");
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const { frame, box } = await findComposer(page, 45_000);
    await page.waitForTimeout(1500); // historial cargando
    return await fn({ page, frame, box, context });
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function readConversation(url: string, opts?: { limit?: number; dataDir?: string }): Promise<string[]> {
  return withConversation(url, ({ frame }) => recentMessages(frame, opts?.limit ?? 15), opts?.dataDir);
}

/** Escribe y envía; verifica que el texto aparezca como mensaje. Saltos de línea con Shift+Enter. */
export async function sendMessage(url: string, text: string, opts?: { dataDir?: string }): Promise<{ verified: boolean; lastMessages: string[] }> {
  return withConversation(
    url,
    async ({ page, frame, box }) => {
      const probe = text.split("\n").find((l) => l.trim().length > 8)?.trim().slice(0, 40) ?? text.slice(0, 40);
      const countProbe = async () => (await recentMessages(frame, 500, { dedupe: false })).filter((m) => m.includes(probe)).length;
      const before = await countProbe();
      await box.click();
      const lines = text.split("\n");
      for (const [i, line] of lines.entries()) {
        if (line) await page.keyboard.insertText(line);
        if (i < lines.length - 1) await page.keyboard.press("Shift+Enter");
      }
      await page.keyboard.press("Enter");
      const deadline = Date.now() + 20_000;
      let last: string[] = [];
      while (Date.now() < deadline) {
        await page.waitForTimeout(1000);
        last = await recentMessages(frame, 5);
        const boxText = (await box.innerText().catch(() => "")).trim();
        if (!boxText && (await countProbe()) > before) return { verified: true, lastMessages: last };
      }
      return { verified: false, lastMessages: last };
    },
    opts?.dataDir,
  );
}
