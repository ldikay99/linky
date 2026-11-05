import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DayPlan, LinkyProfile } from "../types.js";
import { draftsDir } from "../security/paths.js";
import { hoursForDate, scheduleWindowLabel } from "../planning/schedule.js";

export type MessageDraft = {
  kind: "start_of_day" | "end_of_day";
  subject: string;
  body: string;
  filePath?: string;
};

/** Genera borradores locales. Nunca envía a terceros automáticamente. */
export async function writeDayMessageDrafts(
  profile: LinkyProfile,
  plan: DayPlan,
  dataDir?: string,
): Promise<MessageDraft[]> {
  const drafts: MessageDraft[] = [];
  const window = scheduleWindowLabel(profile, plan.date);
  const hours = hoursForDate(profile.schedule, plan.date);

  if (profile.messaging.sendStartOfDay) {
    const planned = plan.activities.filter((a) => a.kind === "planned");
    const body = [
      `Cronograma ${plan.date} (${profile.schedule.timezone})`,
      window,
      hours ? `Ventana configurada: ${hours.start}–${hours.end}` : "Día no laborable según perfil.",
      "",
      "Procesos/actividades planeadas:",
      ...(planned.length ? planned.map((a, i) => `${i + 1}. ${a.title} — ${a.shortDescription}`) : ["(sin actividades planeadas cargadas)"]),
      "",
      "Nota: borrador local. Scheduling desactivado por instalación. No se envía a terceros.",
    ].join("\n");
    drafts.push({ kind: "start_of_day", subject: `Linky inicio ${plan.date}`, body });
  }

  if (profile.messaging.sendEndOfDay) {
    const done = plan.activities.filter((a) => a.kind === "done");
    const body = [
      `Cierre de jornada ${plan.date} (${profile.schedule.timezone})`,
      window,
      "",
      "Actividades registradas:",
      ...(done.length
        ? done.map((a, i) => {
            const mins = a.minutesSpent != null ? `${a.minutesSpent} min` : "sin minutos";
            return `${i + 1}. ${a.title} — ${a.shortDescription} (${mins})`;
          })
        : ["(sin actividades done cargadas)"]),
      "",
      plan.missingQuestions.length ? `Pendientes: ${plan.missingQuestions.join(" | ")}` : "Sin preguntas pendientes en el plan.",
      "",
      "Borrador local únicamente.",
    ].join("\n");
    drafts.push({ kind: "end_of_day", subject: `Linky cierre ${plan.date}`, body });
  }

  const dir = draftsDir(dataDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const d of drafts) {
    const file = path.join(dir, `${plan.date}-${d.kind}.txt`);
    await writeFile(file, `${d.subject}\n\n${d.body}\n`, { encoding: "utf8", mode: 0o600 });
    d.filePath = file;
  }
  return drafts;
}
