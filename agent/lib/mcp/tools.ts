/**
 * Herramientas MCP de Linky: cada una traduce parámetros tipados a argumentos del CLI (ya probado).
 * Las de escritura exigen approved=true + snapshot: la IA debe mostrar el preview y tener el "sí" de la persona.
 */
type Prop = { type: string; description: string; enum?: string[]; items?: { type: string } };
export type ToolDef = {
  name: string;
  description: string;
  properties: Record<string, Prop>;
  required?: string[];
  /** Usa el perfil de navegador compartido (se serializa con las demás que lo usan). */
  browser?: boolean;
  timeoutMs?: number;
  toArgs: (p: Record<string, unknown>) => string[];
};

const str = (description: string): Prop => ({ type: "string", description });
const bool = (description: string): Prop => ({ type: "boolean", description });
const num = (description: string): Prop => ({ type: "number", description });
const DATE = str("Fecha YYYY-MM-DD (por defecto hoy en el equipo).");

function flag(args: string[], name: string, v: unknown) {
  if (v === undefined || v === null || v === "" || v === false) return;
  if (v === true) args.push(`--${name}`);
  else args.push(`--${name}`, String(v));
}

function build(base: string[], p: Record<string, unknown>, map: Record<string, string>): string[] {
  const args = [...base];
  for (const [key, cli] of Object.entries(map)) {
    const v = p[key];
    if (Array.isArray(v)) for (const x of v) flag(args, cli, x);
    else flag(args, cli, v);
  }
  return args;
}

function requireApproval(p: Record<string, unknown>) {
  if (p.approved !== true) throw new Error("Escritura sin aprobación: muestra el preview a la persona y llama de nuevo con approved=true solo si dijo que sí.");
  if (typeof p.snapshot !== "string" || !p.snapshot) throw new Error("Falta snapshot (hash del preview aprobado).");
}

export const TOOLS: ToolDef[] = [
  { name: "linky_welcome", description: "Bienvenida de Linky (logo y créditos). Mostrarla tal cual al empezar el onboarding.", properties: {}, toArgs: () => ["welcome"] },
  { name: "linky_doctor", description: "Estado de todo lo conectado y el arreglo exacto de cada problema. Úsalo primero ante cualquier error.", properties: {}, browser: true, toArgs: () => ["doctor"] },
  {
    name: "linky_day",
    description: "Todo el día en una llamada: jornada/festivos, actividad Azure, Tasks, reuniones (confirmadas o no), Ripor, desarrollo, borradores de chat y siguientes pasos.",
    properties: { date: DATE, all: bool("Todas las organizaciones Azure."), mail: bool("Incluir correos enviados (añade ~18 s).") },
    browser: true,
    timeoutMs: 240_000,
    toArgs: (p) => build(["day"], p, { date: "date", all: "all", mail: "mail" }),
  },
  { name: "linky_alerts", description: "Avisos proactivos: Ripor pendiente (hoy y mes), PAT por vencer, Tasks estancadas, eventos sin clasificar, navegadores huérfanos.", properties: {}, browser: true, timeoutMs: 180_000, toArgs: () => ["alerts"] },
  { name: "linky_cleanup", description: "Cierra navegadores huérfanos de Linky (nunca el navegador personal).", properties: {}, toArgs: () => ["cleanup"] },

  { name: "ripor_month", description: "Días laborables del mes que faltan o están incompletos en Ripor (festivos y fines de semana no se exigen).", properties: { month: str("Mes YYYY-MM."), suggest: bool("Sugerir reporte para cada día pendiente.") }, timeoutMs: 300_000, toArgs: (p) => build(["ripor", "month"], p, { month: "month", suggest: "suggest" }) },
  { name: "ripor_list", description: "Reportes de Ripor de un día.", properties: { date: DATE }, toArgs: (p) => build(["ripor", "list"], p, { date: "date" }) },
  { name: "ripor_suggest", description: "Sugerencia de reporte Ripor desde Azure: descripción breve (sin fechas), evidencia (HU padre o PR) y horas sustentadas.", properties: { date: DATE }, toArgs: (p) => build(["ripor", "suggest"], p, { date: "date" }) },
  {
    name: "ripor_preview",
    description: "Preview de un reporte Ripor (crear o, con update, editar). auto=true completa con la sugerencia. Muestra 'mostrarAlUsuario' a la persona antes de aplicar.",
    properties: {
      date: DATE,
      auto: bool("Completar descripción/evidencia/horas desde Azure."),
      notes: str("Descripción breve (50–500, en pasado, SIN fechas)."),
      evidence: { type: "array", items: { type: "string" }, description: "Enlace(s) de evidencia (preferir uno)." },
      hours: num("Horas (por defecto la jornada exacta)."),
      sustained: num("Horas sustentadas en actividad real."),
      transporte: str("Transporte del día si cambia (label exacto)."),
      update: str("ID del reporte a editar."),
      under_hours: str("Motivo de jornada menor pedida explícitamente por la persona (requiere hours)."),
    },
    toArgs: (p) => build(["ripor", "preview"], p, { date: "date", auto: "auto", notes: "notes", evidence: "evidence", hours: "hours", sustained: "sustained", transporte: "transporte", update: "update", under_hours: "under-hours" }),
  },
  {
    name: "ripor_apply",
    description: "Aplica el último preview de Ripor. SOLO tras el 'sí' explícito de la persona al preview mostrado.",
    properties: { snapshot: str("snapshotHash del preview."), approved_by: str("Quién aprobó."), approved: bool("true solo si la persona aprobó."), delete_confirmed: bool("Confirmación separada para borrar.") },
    required: ["snapshot", "approved_by", "approved"],
    toArgs: (p) => {
      requireApproval(p);
      return build(["ripor", "apply", "--approve"], p, { snapshot: "snapshot", approved_by: "by", delete_confirmed: "delete-confirmed" });
    },
  },
  { name: "ripor_delete_preview", description: "Preview para borrar un reporte (fecha + id). Borrar requiere luego ripor_apply con delete_confirmed.", properties: { date: DATE, id: str("ID del reporte.") }, required: ["date", "id"], toArgs: (p) => build(["ripor", "delete-preview"], p, { date: "date", id: "id" }) },
  { name: "ripor_reconcile", description: "Revisa operaciones Ripor inciertas; con id+status las marca tras verificar.", properties: { id: str("ID de journal."), status: { type: "string", enum: ["ok", "failed"], description: "Resultado verificado." } }, toArgs: (p) => build(["ripor", "reconcile"], p, { id: "id", status: "status" }) },

  { name: "azure_orgs", description: "Organizaciones Azure conectadas, cuál es la principal y su estado.", properties: {}, toArgs: () => ["azure", "orgs"] },
  { name: "azure_activity", description: "Lo que la persona hizo en Azure un día (work items cambiados, estados, horas, comentarios).", properties: { date: DATE, org: str("Organización (por defecto la principal)."), all: bool("Todas las organizaciones.") }, toArgs: (p) => build(["azure", "activity"], p, { date: "date", org: "org", all: "all" }) },
  { name: "azure_hus", description: "HU abiertas de sus sprints donde colgar Tasks (con cuántas Tasks suyas y quién la creó).", properties: { org: str("Organización (por defecto la principal)."), days: num("Días hacia atrás (por defecto 45).") }, toArgs: (p) => build(["azure", "hus"], p, { org: "org", days: "days" }) },
  { name: "azure_ceco", description: "Código de proyecto (CECO) usado en HU previas de un tema. Validar antes de proponer una HU.", properties: { topic: str("Tema de la HU."), org: str("Organización (por defecto la principal).") }, required: ["topic"], toArgs: (p) => build(["azure", "ceco"], p, { topic: "topic", org: "org" }) },
  {
    name: "azure_style",
    description:
      "Estilo de HU/Tasks aprobado por la persona. Sin argumentos lo muestra. Para guardar: SOLO tras proponer el formato y recibir su aprobación.",
    properties: { kind: { type: "string", enum: ["hu", "task"], description: "hu o task." }, title: str("Formato del título."), description: str("Formato de la descripción."), example: str("Ejemplo aprobado.") },
    toArgs: (p) => build(["azure", "style"], p, { kind: "kind", title: "title", description: "description", example: "example" }),
  },
  { name: "azure_hours", description: "Propuesta de horas completadas por Task del día (no inventa; solo reuniones confirmadas). Mostrar a la persona.", properties: { date: DATE, set: str("Horas fijadas: id=h,id=h (acepta 1,5)."), meetings_task: str("Task donde registrar las reuniones confirmadas.") }, browser: true, timeoutMs: 180_000, toArgs: (p) => build(["azure", "hours"], p, { date: "date", set: "set", meetings_task: "meetings-task" }) },
  {
    name: "azure_hours_apply",
    description: "Registra en Azure la última propuesta de horas. SOLO tras el 'sí' explícito de la persona.",
    properties: { snapshot: str("snapshotHash de la propuesta."), approved: bool("true solo si la persona aprobó.") },
    required: ["snapshot", "approved"],
    toArgs: (p) => {
      requireApproval(p);
      return ["azure", "hours", "--apply", "--approve", "--snapshot", String(p.snapshot)];
    },
  },
  {
    name: "azure_delete",
    description: "Sin approved muestra qué se borraría; con approved=true lo envía a la papelera (solo si la persona lo pidió).",
    properties: { id: str("ID del work item."), approved: bool("true solo si la persona confirmó el borrado.") },
    required: ["id"],
    toArgs: (p) => build(["azure", "delete", "--id", String(p.id)], p, { approved: "approve" }),
  },

  { name: "calendar_day", description: "Reuniones del día con Meet y adjuntos (grabaciones, notas, fotos); 'reunion' indica si la persona la confirmó.", properties: { date: DATE }, browser: true, toArgs: (p) => build(["calendar", "day"], p, { date: "date" }) },
  { name: "calendar_meetings", description: "Eventos confirmados, sin confirmar e ignorados. Preguntar por los sin confirmar.", properties: { date: DATE }, browser: true, toArgs: (p) => build(["calendar", "meetings"], p, { date: "date" }) },
  { name: "calendar_confirm", description: "Marca un evento (por texto del título) como reunión de trabajo. Solo si la persona lo dijo.", properties: { title: str("Texto del título.") }, required: ["title"], toArgs: (p) => ["calendar", "confirm", "--title", String(p.title)] },
  { name: "calendar_ignore", description: "Marca un evento (por texto del título) como evento general, no reunión.", properties: { title: str("Texto del título.") }, required: ["title"], toArgs: (p) => ["calendar", "ignore", "--title", String(p.title)] },
  { name: "calendar_download", description: "Descarga adjuntos de reuniones a ~/.linky/evidence/<fecha>/ (Docs→PDF, fotos, chat).", properties: { date: DATE, event: str("Filtrar por texto del título."), only_images: bool("Solo fotos.") }, browser: true, timeoutMs: 300_000, toArgs: (p) => build(["calendar", "download"], p, { date: "date", event: "event", only_images: "only-images" }) },

  { name: "mail_day", description: "Correos del día (enviados por defecto) como evidencia. Solo lectura.", properties: { date: DATE, box: { type: "string", enum: ["sent", "received", "all"], description: "Bandeja." } }, browser: true, timeoutMs: 120_000, toArgs: (p) => build(["mail", "day"], { ...p, received: p.box === "received", all: p.box === "all" }, { date: "date", received: "received", all: "all" }) },
  { name: "dev_day", description: "Commits (con enlace y Tasks AB#) y PRs de Azure del día. Solo si la persona desarrolla.", properties: { date: DATE }, toArgs: (p) => build(["dev", "day"], p, { date: "date" }) },
  { name: "dev_repos", description: "Repos registrados para evidencia de desarrollo.", properties: {}, toArgs: () => ["dev", "repos"] },

  { name: "chat_read", description: "Últimos mensajes del chat de reporte configurado.", properties: { limit: num("Cantidad (por defecto 15).") }, browser: true, toArgs: (p) => build(["chat", "read"], p, { limit: "limit" }) },
  {
    name: "chat_draft",
    description: "Borrador de inicio o cierre de jornada (desde Azure, con la plantilla del área) o texto propio. Mostrar a la persona.",
    properties: {
      kind: { type: "string", enum: ["inicio", "cierre"], description: "Tipo de mensaje." },
      date: DATE,
      text: str("Texto propio en lugar del generado."),
      to: str("URL de otra conversación de Google Chat (p. ej. para pedir una HU al líder). Por defecto, el chat de reporte."),
    },
    toArgs: (p) => build(["chat", "draft"], { ...p, inicio: p.kind === "inicio" && !p.text, cierre: p.kind === "cierre" && !p.text }, { inicio: "inicio", cierre: "cierre", date: "date", text: "text", to: "to" }),
  },
  {
    name: "chat_send",
    description: "Opcional (solo si el área reporta en Google Chat). Publica el último borrador en el chat. SOLO tras el 'sí' explícito de la persona al texto mostrado.",
    properties: { snapshot: str("snapshotHash del borrador."), approved: bool("true solo si la persona aprobó.") },
    required: ["snapshot", "approved"],
    browser: true,
    toArgs: (p) => {
      requireApproval(p);
      return ["chat", "send", "--approve", "--snapshot", String(p.snapshot)];
    },
  },
];

export function jsonSchema(t: ToolDef) {
  return { type: "object", properties: t.properties, required: t.required ?? [], additionalProperties: false };
}
