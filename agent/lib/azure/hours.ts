/**
 * Propuesta de horas completadas (CompletedWork) por Task para un día, sin inventar:
 * pendiente = jornada − horas ya registradas ese día en Azure − reuniones CONFIRMADAS.
 * Se reparte solo entre Tasks que la persona tocó ese día, según evidencia de actividad.
 * Siempre es una propuesta: la persona ajusta (--set) y aprueba antes de escribir.
 */

export type HoursTask = {
  id: number;
  title: string;
  project: string;
  completed: number;
  rev: number;
  /** Señales de trabajo ese día: cambios de estado, comentarios, commits que la mencionan. */
  activity: number;
};

export type HoursProposal = {
  dateYmd: string;
  jornada: number;
  yaRegistradas: number;
  reuniones: number;
  pendiente: number;
  tareas: Array<{ id: number; title: string; project: string; completadas: number; propuesta: number; nuevo: number; rev: number; fijada: boolean }>;
  avisos: string[];
};

const quarter = (h: number) => Math.round(h * 4) / 4;

export function proposeHours(input: {
  dateYmd: string;
  jornada: number;
  yaRegistradas: number;
  reunionesConfirmadas: number;
  tasks: HoursTask[];
  fixed?: Record<number, number>;
  meetingsTaskId?: number;
}): HoursProposal {
  const avisos: string[] = [];
  const fixed = input.fixed ?? {};
  // Hacia abajo: redondear lo pendiente nunca puede llevar el día por encima de la jornada.
  const pendiente = Math.max(0, Math.floor((input.jornada - input.yaRegistradas - input.reunionesConfirmadas) * 4 + 1e-9) / 4);
  const fixedTotal = Object.values(fixed).reduce((s, h) => s + h, 0);
  if (fixedTotal > pendiente + 1e-9) avisos.push(`Las horas fijadas (${fixedTotal} h) superan lo pendiente (${pendiente} h): revisar con la persona.`);

  const distributable = input.tasks.filter((t) => fixed[t.id] === undefined && t.id !== input.meetingsTaskId);
  const remaining = Math.max(0, pendiente - fixedTotal);
  const weightTotal = distributable.reduce((s, t) => s + Math.max(1, t.activity), 0);

  const props = new Map<number, number>();
  for (const [id, h] of Object.entries(fixed)) props.set(Number(id), quarter(h));
  if (weightTotal > 0 && remaining > 0) {
    // Reparto en cuartos de hora por restos mayores: la suma es EXACTAMENTE lo pendiente (nunca más).
    const totalQ = Math.floor(remaining * 4 + 1e-9);
    const exact = distributable.map((t) => (totalQ * Math.max(1, t.activity)) / weightTotal);
    const q = exact.map(Math.floor);
    let left = totalQ - q.reduce((s, x) => s + x, 0);
    const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const { i } of order) {
      if (left <= 0) break;
      q[i] += 1;
      left -= 1;
    }
    distributable.forEach((t, i) => {
      if (q[i] > 0) props.set(t.id, (props.get(t.id) ?? 0) + q[i] / 4);
    });
  } else if (remaining > 0 && !distributable.length) {
    avisos.push(`Quedan ${remaining} h sin Tasks donde repartir: preguntar a la persona en qué trabajó.`);
  }
  if (input.meetingsTaskId !== undefined && input.reunionesConfirmadas > 0) {
    props.set(input.meetingsTaskId, quarter((props.get(input.meetingsTaskId) ?? 0) + input.reunionesConfirmadas));
  } else if (input.reunionesConfirmadas > 0) {
    avisos.push(`${input.reunionesConfirmadas} h de reuniones confirmadas: indicar la Task de reuniones con --meetings-task <id> para registrarlas.`);
  }
  if (input.yaRegistradas >= input.jornada && !Object.keys(fixed).length) avisos.push("Azure ya tiene registrada la jornada completa ese día.");

  const tareas = input.tasks
    .filter((t) => (props.get(t.id) ?? 0) > 0)
    .map((t) => {
      const propuesta = props.get(t.id) ?? 0;
      return { id: t.id, title: t.title, project: t.project, completadas: t.completed, propuesta, nuevo: quarter(t.completed + propuesta), rev: t.rev, fijada: fixed[t.id] !== undefined };
    });
  for (const id of props.keys()) {
    if (!input.tasks.some((t) => t.id === id)) avisos.push(`La Task #${id} no está entre las del día: se omite (verificar el número).`);
  }
  return { dateYmd: input.dateYmd, jornada: input.jornada, yaRegistradas: input.yaRegistradas, reuniones: input.reunionesConfirmadas, pendiente, tareas, avisos };
}

/** "558412=2,558413=1.5" → { 558412: 2, 558413: 1.5 } */
export function parseFixedHours(spec: string | undefined): Record<number, number> {
  if (!spec) return {};
  const out: Record<number, number> = {};
  // La coma separa Tasks solo si le sigue otro "id=" (así "1,5" sigue siendo decimal).
  for (const part of spec.split(/[,;]\s*(?=#?\d+\s*=)/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^#?(\d+)\s*=\s*(\d+(?:[.,]\d+)?)$/.exec(part);
    if (!m) throw new Error(`--set inválido: "${part}" (formato id=horas, p. ej. 558412=2)`);
    out[Number(m[1])] = Number(m[2].replace(",", "."));
  }
  return out;
}
