/**
 * Correos del día como evidencia (enviados por la persona; opcional recibidos), con la sesión de Google del
 * perfil de Linky en headless. Solo lectura: asunto, personas, hora, fragmento y enlace al hilo.
 */
import { openSharedBrowser, safeBrowserError } from "../browser/shared.js";
import { hasGoogleSession } from "../chat/browser.js";
import { zonedToUtc } from "../calendar/ics.js";

export type MailBox = "sent" | "received" | "all";

export type MailItem = { subject: string; people: string[]; time?: string; snippet?: string; url?: string };

/** Búsqueda de Gmail con límites exactos del día local (epoch en segundos). */
export function gmailDayQuery(dateYmd: string, box: MailBox, timeZone: string): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const start = Math.floor(zonedToUtc(y, m, d, 0, 0, 0, timeZone) / 1000);
  const end = start + 86_400;
  // Solo operadores positivos: Gmail en headless no resuelve búsquedas con negativos (-in:…).
  const where = box === "sent" ? "in:sent " : box === "received" ? "in:inbox " : "";
  return `${where}after:${start} before:${end}`;
}

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

/** "mié, 2 sept 2026, 18:02" / "Wed, Sep 2, 2026, 6:02 PM" → "2026-09-02" (fecha del título de la fila). */
export function gmailTitleYmd(title: string): string | undefined {
  const t = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const year = /\b(20\d{2})\b/.exec(t)?.[1];
  const month = /\b(ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sept|sep|oct|nov|dic|dec)[a-z]*\.?/.exec(t)?.[1];
  const rest = t.replace(/\b20\d{2}\b/, " ").replace(/\d{1,2}:\d{2}/g, " ");
  const day = /(?:^|[\s,])(\d{1,2})(?=[\s,]|$)/.exec(rest)?.[1];
  if (!year || !month || !day) return undefined;
  return `${year}-${String(MONTHS[month]).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function gmailDay(input: { dateYmd: string; box?: MailBox; timeZone?: string; dataDir?: string }): Promise<MailItem[]> {
  const tz = input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = gmailDayQuery(input.dateYmd, input.box ?? "sent", tz);
  const context = await openSharedBrowser({ headless: true, dataDir: input.dataDir });
  try {
    if (!(await hasGoogleSession(context))) throw new Error("No hay sesión de Google en el perfil de Linky. Ejecuta: npm run linky -- google login");
    const page = context.pages()[0] ?? (await context.newPage());
    // Abrir Gmail y buscar como una persona (la búsqueda directa por URL se queda cargando en headless).
    await page.goto("https://mail.google.com/mail/u/0/#inbox", { waitUntil: "domcontentloaded" });
    const box = page.locator('input[name="q"]');
    await box.waitFor({ timeout: 45_000 }).catch(() => {
      throw new Error("Gmail no cargó a tiempo; reintenta.");
    });
    // Gmail recién cargado a veces ignora el primer Enter: reintentar hasta que la URL confirme la búsqueda.
    let searched = false;
    for (let i = 0; i < 4 && !searched; i++) {
      await box.fill(query);
      await box.press("Enter");
      searched = await page
        .waitForURL((u) => u.hash.startsWith("#search/"), { timeout: 6_000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!searched) throw new Error("Gmail no aplicó la búsqueda; reintenta.");
    const main = page.locator('[role="main"]');
    // Esperar un resultado estable: mismas filas del día (o "sin resultados") en dos lecturas seguidas.
    const read = () =>
      main.locator("tr.zA").evaluateAll((rows) =>
        // Gmail oculta (sin quitar) la vista anterior: solo filas visibles de la vista activa.
        rows.filter((r) => (r as HTMLElement).offsetParent !== null).map((r) => {
          const people = [...r.querySelectorAll("[email]")].map((e) => {
            const name = (e.getAttribute("name") ?? (e as HTMLElement).innerText ?? "").trim();
            const mail = e.getAttribute("email") ?? "";
            return name && name !== mail ? `${name} <${mail}>` : mail;
          });
          const legacy = r.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id");
          return {
            subject: ((r.querySelector(".bog") as HTMLElement | null)?.innerText ?? "").trim(),
            people: [...new Set(people)],
            time: r.querySelector(".xW span")?.getAttribute("title") ?? undefined,
            snippet: ((r.querySelector(".y2") as HTMLElement | null)?.innerText ?? "").replace(/^\s*[-–]\s*/, "").trim().slice(0, 160) || undefined,
            url: legacy ? `https://mail.google.com/mail/u/0/#all/${legacy}` : undefined,
          };
        }),
      );
    const start = Date.now();
    let last = "";
    let result: MailItem[] = [];
    while (Date.now() - start < 30_000) {
      await page.waitForTimeout(800);
      // Solo filas cuya fecha es el día pedido: una vista vieja todavía en pantalla nunca contamina.
      const rows = (await read()).filter((r) => r.time && gmailTitleYmd(r.time) === input.dateYmd);
      const none = await main.locator("td.TC:visible").count();
      const sig = `${rows.length}|${none}|${rows.map((r) => r.url).join(",")}`;
      if (sig === last && Date.now() - start > 2_000 && (rows.length || none)) {
        result = rows;
        break;
      }
      last = sig;
      result = rows;
    }
    return result;
  } catch (e) {
    throw safeBrowserError(e, "Gmail");
  } finally {
    await context.close().catch(() => undefined);
  }
}
