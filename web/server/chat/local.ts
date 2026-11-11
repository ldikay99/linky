/**
 * Modo sin proveedor de IA: el chat sigue siendo útil con acciones directas de Linky
 * (estado, día, avisos, Ripor del mes, reuniones). Cuando se configure el proveedor, la IA toma el control.
 */
export type LocalPlan =
  | { kind: "tool"; name: string; input: Record<string, unknown>; intro: string }
  | { kind: "text"; text: string; action?: "open-connectors" | "open-onboarding" };

export function todayIn(timeZone: string, offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function dateFrom(text: string, timeZone: string): string | undefined {
  const t = text.toLowerCase();
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return iso[0];
  const dm = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](20\d{2}))?\b/.exec(t);
  if (dm) {
    const year = dm[3] ?? todayIn(timeZone).slice(0, 4);
    return `${year}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  }
  if (/\banteayer\b/.test(t)) return todayIn(timeZone, -2);
  if (/\bayer\b/.test(t)) return todayIn(timeZone, -1);
  if (/\bhoy\b/.test(t)) return todayIn(timeZone);
  return undefined;
}

const HELP = [
  "El asistente de IA todavía no está configurado en este servidor, pero ya puedes usar Linky directamente:",
  "",
  "- **Estado de tus conexiones**: escribe *estado*.",
  "- **Tu día**: *mi día*, *mi día de ayer* o *día 2026-11-10*.",
  "- **Avisos**: *avisos*.",
  "- **Ripor del mes**: *ripor mes*.",
  "- **Memoria**: *recuerda que …* o *busca …*.",
  "- **Reuniones**: *reuniones de hoy*.",
  "- **Conectar cuentas**: abre *Conectores* en la barra lateral.",
].join("\n");

export function planLocal(text: string, timeZone: string): LocalPlan {
  const t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const date = dateFrom(text, timeZone);
  const remember = /^\s*(recuerda|recuerde|recordar|anota|guarda)\s+(que\s+)?(.{3,})$/i.exec(text.trim());
  if (remember) return { kind: "tool", name: "memoria_guardar", input: { texto: remember[3] }, intro: "Lo guardo en tu memoria." };
  const find = /^\s*(busca|buscar|encuentra)\s+(en\s+(la\s+)?memoria\s+)?(.{3,})$/i.exec(text.trim());
  if (find) return { kind: "tool", name: "memoria_buscar", input: { consulta: find[4] }, intro: "Busco en tu memoria y conversaciones anteriores." };
  if (/\b(conector|conectar|vincular|token|pat)\b/.test(t)) {
    return { kind: "text", text: "Las cuentas se conectan desde el panel **Conectores**: ahí ingresas tu token de Azure de forma segura e inicias sesión en Google y Ripor.", action: "open-connectors" };
  }
  if (/\b(onboarding|empezar|configurar|bienvenida)\b/.test(t)) {
    return { kind: "text", text: "Te llevo a la configuración inicial, paso a paso.", action: "open-onboarding" };
  }
  if (/\b(estado|doctor|conexion|conexiones|diagnostic)/.test(t)) return { kind: "tool", name: "linky_doctor", input: {}, intro: "Reviso el estado de todo lo conectado." };
  if (/\b(aviso|avisos|alerta|alertas|pendiente)/.test(t) && !/ripor/.test(t)) return { kind: "tool", name: "linky_alerts", input: {}, intro: "Busco avisos pendientes." };
  if (/ripor/.test(t) && /\b(mes|pendiente|faltan|falta)/.test(t)) return { kind: "tool", name: "ripor_month", input: {}, intro: "Reviso qué días del mes faltan en Ripor." };
  if (/\b(reunion|reuniones|calendario|eventos|llamadas)/.test(t)) return { kind: "tool", name: "calendar_meetings", input: date ? { date } : {}, intro: "Leo tus eventos del calendario." };
  if (/\b(commit|commits|pr|prs|repos)\b/.test(t)) return { kind: "tool", name: "dev_day", input: date ? { date } : {}, intro: "Leo tus commits y PR del día." };
  if (/\b(dia|jornada|hice|resumen)\b/.test(t) || date) return { kind: "tool", name: "linky_day", input: { ...(date ? { date } : {}), all: true }, intro: "Reviso todo tu día." };
  return { kind: "text", text: HELP };
}

type Check = { area?: string; ok?: boolean; detail?: string; fix?: string };

/** Resumen legible de las salidas más comunes (el detalle completo queda en la tarjeta de la herramienta). */
export function summarizeLocal(name: string, json: unknown, raw = ""): string | null {
  if (name === "memoria_guardar" || name === "memoria_buscar") return raw || null;
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  if (name === "linky_doctor" && Array.isArray(j.checks)) {
    const checks = j.checks as Check[];
    const bad = checks.filter((c) => !c.ok);
    const lines = checks.map((c) => `- ${c.ok ? "Listo" : "**Revisar**"} · ${c.area}: ${c.detail ?? ""}${c.fix ? ` — ${c.fix}` : ""}`);
    return `${bad.length ? `Hay ${bad.length} punto(s) por revisar.` : "Todo está conectado y en orden."}\n\n${lines.join("\n")}`;
  }
  if (name === "linky_day") {
    const ripor = j.ripor as { reportado?: number; esperado?: number } | undefined;
    const reuniones = Array.isArray(j.reuniones) ? j.reuniones.length : 0;
    const orgs = ((j.azure as { organizaciones?: Array<{ actividad?: unknown[]; horasCompletadas?: number }> })?.organizaciones ?? []);
    const items = orgs.reduce((n, o) => n + (o.actividad?.length ?? 0), 0);
    const horas = orgs.reduce((n, o) => n + (o.horasCompletadas ?? 0), 0);
    const pasos = Array.isArray(j.siguientesPasos) ? (j.siguientesPasos as string[]) : [];
    const errores = j.errores && typeof j.errores === "object" ? Object.values(j.errores as Record<string, string>) : [];
    return [
      `**${j.fecha ?? "Día"}**`,
      "",
      `- Azure: ${items} work item(s) con cambios, ${horas} h completadas.`,
      `- Reuniones: ${reuniones}.`,
      ripor ? `- Ripor: ${ripor.reportado ?? 0} de ${ripor.esperado ?? 0} h.` : "",
      pasos.length ? `\n**Siguientes pasos**\n${pasos.map((p) => `- ${p}`).join("\n")}` : "",
      errores.length ? `\n**No se pudo leer**\n${errores.map((e) => `- ${e}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return null;
}
