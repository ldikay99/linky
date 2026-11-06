/**
 * Avisos proactivos a partir del estado ya leído (lógica pura, testeable).
 * nivel: "alta" = actuar hoy; "media" = pronto; "info" = sugerencia.
 */
export type Alert = { nivel: "alta" | "media" | "info"; area: string; mensaje: string; accion?: string };

const daysBetween = (fromYmd: string, toYmd: string) =>
  Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / 86_400_000);

export function buildAlerts(input: {
  todayYmd: string;
  nowHHmm: string;
  laborableHoy: boolean;
  finJornadaHHmm?: string;
  ripor?: { reportadoHoy?: number; esperadoHoy: number; diasPendientesMes: string[]; sesion: boolean; journalBloqueado?: string };
  /** funciona=false si el token ya no autentica (vencido o revocado). */
  pats: Array<{ organizacion: string; vence?: string; funciona?: boolean }>;
  /** Avisos "nearing expiration" que Azure envió por correo. */
  avisosAzure?: Array<{ organization: string; expiresOn: string }>;
  tareasEnCurso: Array<{ id: number; titulo: string; desde?: string }>;
  diasEstancada?: number;
  eventosSinClasificar?: number;
  huerfanos?: number;
  google?: boolean;
}): Alert[] {
  const out: Alert[] = [];
  const r = input.ripor;
  if (r) {
    if (!r.sesion) out.push({ nivel: "alta", area: "ripor", mensaje: "Sin sesión de Ripor.", accion: "npm run linky -- ripor login" });
    if (r.journalBloqueado) out.push({ nivel: "alta", area: "ripor", mensaje: r.journalBloqueado, accion: "npm run linky -- ripor reconcile" });
    if (input.laborableHoy && r.reportadoHoy !== undefined && r.reportadoHoy + 1e-9 < r.esperadoHoy) {
      const tarde = input.finJornadaHHmm ? input.nowHHmm >= input.finJornadaHHmm : false;
      out.push({
        nivel: tarde ? "alta" : "media",
        area: "ripor",
        mensaje: `Hoy van ${r.reportadoHoy} h de ${r.esperadoHoy} h en Ripor${tarde ? " y ya termina la jornada" : ""}.`,
        accion: "npm run linky -- ripor preview --auto",
      });
    }
    const pasados = r.diasPendientesMes.filter((d) => d < input.todayYmd);
    if (pasados.length) {
      out.push({ nivel: "alta", area: "ripor", mensaje: `${pasados.length} día(s) del mes sin completar en Ripor: ${pasados.join(", ")}.`, accion: "npm run linky -- ripor month --suggest" });
    }
  }
  const renew = (org: string) => `Crear un PAT nuevo en ${org} (Full access, 90 días) y conectarlo: npm run linky -- azure connect --org ${org}`;
  for (const p of input.pats) {
    if (p.funciona === false) {
      out.push({ nivel: "alta", area: "azure", mensaje: `El PAT de ${p.organizacion} ya no funciona (vencido o revocado).`, accion: renew(p.organizacion) });
      continue;
    }
    // Aviso de Azure por correo: solo si es el token que usa Linky (misma fecha) o si su fecha no se conoce.
    const orgName = p.organizacion.split("/").filter(Boolean).pop()!.toLowerCase();
    for (const n of input.avisosAzure ?? []) {
      if (n.organization.toLowerCase() !== orgName || n.expiresOn < input.todayYmd) continue;
      if (!p.vence || p.vence === n.expiresOn) {
        out.push({ nivel: "media", area: "azure", mensaje: `Azure avisa que un PAT de ${p.organizacion} vence el ${n.expiresOn}.`, accion: renew(p.organizacion) });
      }
    }
    if (!p.vence) continue; // sin fecha: se detecta por correo de Azure o al fallar el token
    const left = daysBetween(input.todayYmd, p.vence);
    if (left < 0) out.push({ nivel: "alta", area: "azure", mensaje: `El PAT de ${p.organizacion} venció (${p.vence}).`, accion: renew(p.organizacion) });
    else if (left <= 7) out.push({ nivel: "media", area: "azure", mensaje: `El PAT de ${p.organizacion} vence en ${left} día(s) (${p.vence}).`, accion: renew(p.organizacion) });
  }
  const limit = input.diasEstancada ?? 7;
  for (const t of input.tareasEnCurso) {
    if (!t.desde) continue;
    const dias = daysBetween(t.desde.slice(0, 10), input.todayYmd);
    if (dias > limit) out.push({ nivel: "info", area: "azure", mensaje: `La Task #${t.id} "${t.titulo}" lleva ${dias} días en curso.`, accion: "¿Se entregó o sigue en curso? Actualizar estado con preview/apply." });
  }
  if (input.eventosSinClasificar) {
    out.push({ nivel: "info", area: "calendar", mensaje: `${input.eventosSinClasificar} evento(s) de hoy sin clasificar como reunión o no.`, accion: "npm run linky -- calendar meetings" });
  }
  if (input.huerfanos) out.push({ nivel: "media", area: "sistema", mensaje: `${input.huerfanos} navegador(es) de Linky huérfanos ocupando recursos.`, accion: "npm run linky -- cleanup" });
  if (input.google === false) out.push({ nivel: "media", area: "google", mensaje: "Sin sesión de Google (Chat, Calendar, correos).", accion: "npm run linky -- google login" });
  const order = { alta: 0, media: 1, info: 2 };
  return out.sort((a, b) => order[a.nivel] - order[b.nivel]);
}
