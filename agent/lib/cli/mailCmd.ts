/** Correos del día como evidencia (solo lectura). */
import { gmailDay, type MailBox } from "../mail/gmail.js";
import { todayLocalYmd, type argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

export async function runMailCommand(sub: string | undefined, a: Argv, dataDir?: string): Promise<void> {
  if (sub === "day") {
    const dateYmd = a.arg("--date") ?? todayLocalYmd();
    const box: MailBox = a.has("--all") ? "all" : a.has("--received") ? "received" : "sent";
    const items = await gmailDay({ dateYmd, box, dataDir });
    console.log(JSON.stringify({ dateYmd, bandeja: box, total: items.length, correos: items }, null, 2));
    return;
  }
  console.log(`linky mail <day>
  day [--date YYYY-MM-DD] [--received | --all]   correos del día (por defecto los ENVIADOS): asunto, personas, hora, enlace al hilo`);
  if (sub) process.exitCode = 1;
}
