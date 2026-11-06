/**
 * Parser iCalendar (RFC 5545) suficiente para la exportación de Google Calendar:
 * eventos, zonas horarias, recurrencias comunes (DAILY/WEEKLY/MONTHLY/YEARLY con INTERVAL, BYDAY,
 * UNTIL, COUNT), EXDATE y ocurrencias movidas (RECURRENCE-ID). Solo lectura.
 */

export type IcsAttachment = { url: string; title?: string; mime?: string };

export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  status?: string;
  start: IcsTime;
  end?: IcsTime;
  rrule?: Record<string, string>;
  exdates: number[];
  recurrenceId?: number;
  attendees: Array<{ email: string; partstat?: string }>;
  organizer?: string;
  meetUrl?: string;
  attachments: IcsAttachment[];
};

/** Hora del evento: instante UTC + forma original (para repetir la hora de pared en recurrencias). */
export type IcsTime = { utcMs: number; allDay: boolean; wall: [number, number, number, number, number, number]; tz?: string };

type Prop = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Prop | null {
  // NAME;P=V;P2="v:x":VALUE — el ":" de separación es el primero fuera de comillas.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** Desfase (ms) de una zona IANA en un instante dado. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs;
}

/** Hora de pared en una zona → instante UTC. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = guess - tzOffsetMs(guess, tz);
  utc = guess - tzOffsetMs(utc, tz);
  return utc;
}

function parseTime(prop: Prop, defaultTz: string): IcsTime {
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) throw new Error(`Fecha iCal inválida: ${v}`);
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0)) as [number, number, number, number, number, number];
  if (!m[4] || prop.params.VALUE === "DATE") {
    return { utcMs: Date.UTC(y, mo - 1, d), allDay: true, wall: [y, mo, d, 0, 0, 0] };
  }
  if (m[7]) return { utcMs: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false, wall: [y, mo, d, h, mi, s], tz: "UTC" };
  const tz = prop.params.TZID ?? defaultTz;
  return { utcMs: zonedToUtc(y, mo, d, h, mi, s, tz), allDay: false, wall: [y, mo, d, h, mi, s], tz };
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

export function parseIcs(text: string, defaultTz: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> & { attendees: IcsEvent["attendees"]; attachments: IcsAttachment[]; exdates: number[] } | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      cur = { attendees: [], attachments: [], exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.uid && cur.start) events.push({ summary: "(sin título)", ...cur } as IcsEvent);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    try {
      switch (p.name) {
        case "UID": cur.uid = p.value; break;
        case "SUMMARY": cur.summary = unescapeText(p.value); break;
        case "DESCRIPTION": cur.description = unescapeText(p.value); break;
        case "LOCATION": cur.location = unescapeText(p.value); break;
        case "STATUS": cur.status = p.value.toUpperCase(); break;
        case "DTSTART": cur.start = parseTime(p, defaultTz); break;
        case "DTEND": cur.end = parseTime(p, defaultTz); break;
        case "RRULE":
          cur.rrule = Object.fromEntries(p.value.split(";").map((kv) => kv.split("=") as [string, string]));
          break;
        case "EXDATE":
          for (const v of p.value.split(",")) cur.exdates.push(parseTime({ ...p, value: v }, defaultTz).utcMs);
          break;
        case "RECURRENCE-ID": cur.recurrenceId = parseTime(p, defaultTz).utcMs; break;
        case "ATTENDEE":
          cur.attendees.push({ email: p.value.replace(/^mailto:/i, "").toLowerCase(), partstat: p.params.PARTSTAT });
          break;
        case "ORGANIZER": cur.organizer = p.params.CN ?? p.value.replace(/^mailto:/i, ""); break;
        case "X-GOOGLE-CONFERENCE": cur.meetUrl = p.value; break;
        case "ATTACH":
          if (/^https?:/i.test(p.value)) cur.attachments.push({ url: p.value, title: p.params.FILENAME, mime: p.params.FMTTYPE });
          break;
      }
    } catch {
      /* propiedad malformada: se ignora sin romper el resto */
    }
  }
  for (const e of events) {
    if (!e.meetUrl) e.meetUrl = (e.description ?? "").match(/https:\/\/meet\.google\.com\/[\w-]+/)?.[0];
  }
  return events;
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}

/** ¿La regla de recurrencia produce una ocurrencia en ese día de calendario? (día sin hora) */
function occursOn(e: IcsEvent, y: number, m: number, d: number): boolean {
  const r = e.rrule!;
  const freq = r.FREQ;
  const interval = Number(r.INTERVAL ?? 1);
  const [sy, sm, sd] = e.start.wall;
  const startDay = Date.UTC(sy, sm - 1, sd);
  const target = Date.UTC(y, m - 1, d);
  if (target < startDay) return false;
  const dayDiff = Math.round((target - startDay) / 86_400_000);
  const wd = new Date(target).getUTCDay();
  const byday = r.BYDAY?.split(",").map((x) => x.replace(/^[+-]?\d+/, ""));
  if (freq === "DAILY") return dayDiff % interval === 0 && (!byday || byday.includes(WEEKDAYS[wd]));
  if (freq === "WEEKLY") {
    const days = byday ?? [WEEKDAYS[new Date(startDay).getUTCDay()]];
    if (!days.includes(WEEKDAYS[wd])) return false;
    const weekStart = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86_400_000; // semana desde lunes
    const weeks = Math.round((weekStart(target) - weekStart(startDay)) / (7 * 86_400_000));
    return weeks % interval === 0;
  }
  if (freq === "MONTHLY") {
    const months = (y - sy) * 12 + (m - sm);
    return months % interval === 0 && d === Number(r.BYMONTHDAY ?? sd);
  }
  if (freq === "YEARLY") return (y - sy) % interval === 0 && m === sm && d === sd;
  return false;
}

export type DayEvent = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** Duración en minutos (0 si es de todo el día). */
  minutes: number;
  recurring: boolean;
  meetUrl?: string;
  attachments: IcsAttachment[];
  links: string[];
  organizer?: string;
  attendees: number;
  myResponse?: string;
  location?: string;
};

function hhmm(utcMs: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(utcMs));
}

/**
 * Eventos de un día (zona del equipo): expande recurrencias, aplica excepciones y ocurrencias movidas,
 * y descarta cancelados y los que la persona rechazó.
 */
export function eventsOnDate(events: IcsEvent[], dateYmd: string, tz: string, selfEmail?: string): DayEvent[] {
  const [y, m, d] = ymdParts(dateYmd);
  const dayStart = zonedToUtc(y, m, d, 0, 0, 0, tz);
  const dayEnd = dayStart + 86_400_000;
  const overrides = new Map<string, Set<number>>();
  for (const e of events) if (e.recurrenceId != null) (overrides.get(e.uid) ?? overrides.set(e.uid, new Set()).get(e.uid)!).add(e.recurrenceId);

  const out: Array<DayEvent & { sort: number }> = [];
  for (const e of events) {
    if (e.status === "CANCELLED") continue;
    const me = selfEmail ? e.attendees.find((a) => a.email === selfEmail.toLowerCase()) : undefined;
    if (me?.partstat === "DECLINED") continue;
    const duration = (e.end?.utcMs ?? e.start.utcMs + (e.start.allDay ? 86_400_000 : 3_600_000)) - e.start.utcMs;

    let startMs: number | undefined;
    if (e.rrule && e.recurrenceId == null) {
      // Probar el día objetivo y el anterior (eventos que cruzan medianoche / desfase de zona).
      for (const back of [0, 1]) {
        const probe = new Date(Date.UTC(y, m - 1, d) - back * 86_400_000);
        const [py, pm, pd] = [probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate()];
        if (!occursOn(e, py, pm, pd)) continue;
        const [, , , h, mi, s] = e.start.wall;
        const occ = e.start.allDay ? Date.UTC(py, pm - 1, pd) : zonedToUtc(py, pm, pd, h, mi, s, e.start.tz ?? tz);
        if (e.rrule.UNTIL) {
          const until = parseTime({ name: "UNTIL", params: {}, value: e.rrule.UNTIL }, tz).utcMs;
          if (occ > until + (e.rrule.UNTIL.length === 8 ? 86_399_999 : 0)) continue;
        }
        if (e.rrule.COUNT) {
          let n = 0;
          for (let t = Date.UTC(e.start.wall[0], e.start.wall[1] - 1, e.start.wall[2]); t <= Date.UTC(py, pm - 1, pd); t += 86_400_000) {
            const dt = new Date(t);
            if (occursOn(e, dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())) n++;
          }
          if (n > Number(e.rrule.COUNT)) continue;
        }
        if (e.exdates.includes(occ) || overrides.get(e.uid)?.has(occ)) continue;
        if (occ < dayEnd && occ + duration > dayStart) startMs = occ;
      }
    } else if (e.start.allDay) {
      const endDay = e.end?.utcMs ?? e.start.utcMs + 86_400_000;
      if (Date.UTC(y, m - 1, d) >= e.start.utcMs && Date.UTC(y, m - 1, d) < endDay) startMs = e.start.utcMs;
    } else if (e.start.utcMs < dayEnd && e.start.utcMs + duration > dayStart) {
      startMs = e.start.utcMs;
    }
    if (startMs === undefined) continue;

    const links = [...new Set(((e.description ?? "") + " " + (e.location ?? "")).match(URL_RE) ?? [])].filter(
      (u) => u !== e.meetUrl && !e.attachments.some((a) => a.url === u),
    );
    out.push({
      sort: e.start.allDay ? -1 : startMs,
      title: e.summary,
      start: e.start.allDay ? "todo el día" : hhmm(startMs, tz),
      end: e.start.allDay ? "" : hhmm(startMs + duration, tz),
      allDay: e.start.allDay,
      minutes: e.start.allDay ? 0 : Math.round(duration / 60_000),
      recurring: Boolean(e.rrule || e.recurrenceId != null),
      meetUrl: e.meetUrl,
      attachments: e.attachments,
      links,
      organizer: e.organizer,
      attendees: e.attendees.length,
      myResponse: me?.partstat,
      location: e.location && !/^https?:/.test(e.location) ? e.location : undefined,
    });
  }
  return out.sort((a, b) => a.sort - b.sort).map(({ sort: _s, ...rest }) => rest);
}
