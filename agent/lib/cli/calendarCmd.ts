/**
 * Google Calendar: reuniones del día como evidencia (Meet, adjuntos de Drive, enlaces), festivos y descarga
 * de adjuntos (fotos, notas/transcripciones en PDF, chat) para adjuntarlos en Azure.
 */
import { attachmentKind, downloadMeetingAttachments, type AttachmentKind } from "../calendar/download.js";
import { calendarDay, downloadCalendarExport } from "../calendar/export.js";
import { todayLocalYmd, type argvHelpers } from "./riporHttp.js";

type Argv = ReturnType<typeof argvHelpers>;

export async function runCalendarCommand(sub: string | undefined, a: Argv, dataDir?: string): Promise<void> {
  if (sub === "day") {
    const files = await downloadCalendarExport({ dataDir });
    const day = calendarDay(files, a.arg("--date") ?? todayLocalYmd(), { allCalendars: a.has("--all-calendars") });
    console.log(JSON.stringify(day, null, 2));
    return;
  }

  if (sub === "download") {
    const dateYmd = a.arg("--date") ?? todayLocalYmd();
    const day = calendarDay(await downloadCalendarExport({ dataDir }), dateYmd, { allCalendars: a.has("--all-calendars") });
    const filter = a.arg("--event")?.toLowerCase();
    const kinds: AttachmentKind[] = ["image", "doc", "text"];
    if (a.has("--videos")) kinds.push("video");
    if (a.has("--only-images")) kinds.splice(0, kinds.length, "image");
    const items = day.events
      .filter((e) => !filter || e.title.toLowerCase().includes(filter))
      .flatMap((e) => e.attachments.map((attachment) => ({ meeting: e.title, attachment })));
    const results = await downloadMeetingAttachments({
      dateYmd,
      items,
      kinds,
      maxBytes: a.arg("--max-mb") ? Number(a.arg("--max-mb")) * 1024 * 1024 : undefined,
      dataDir,
    });
    const skipped = items.filter((i) => !kinds.includes(attachmentKind(i.attachment)));
    console.log(
      JSON.stringify(
        {
          dateYmd,
          descargados: results.filter((r) => r.path),
          errores: results.filter((r) => r.error),
          omitidos: skipped.map((s) => ({ meeting: s.meeting, title: s.attachment.title, tipo: s.attachment.mime })),
          uso: "Fotos (image/*) → evidenceImages de la actividad en Azure (se suben como adjunto). PDFs/chat → evidencia local o enlace.",
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`linky calendar <day|download>
  day      [--date YYYY-MM-DD] [--all-calendars]   reuniones: hora, Meet, adjuntos (fotos/notas/grabaciones), enlaces; festivos
  download [--date …] [--event "<texto>"] [--only-images] [--videos] [--max-mb N]
           baja adjuntos a ~/.linky/evidence/<fecha>/ (Docs → PDF; grabaciones solo con --videos)`);
  if (sub) process.exitCode = 1;
}
