import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { eventsOnDate, parseIcs, zonedToUtc } from "../agent/lib/calendar/ics.js";
import { calendarDay, primaryCalendar } from "../agent/lib/calendar/export.js";
import { unzipEntries } from "../agent/lib/calendar/zip.js";

const TZ = "America/Bogota";
const ME = "persona@example.com";

function ics(events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
}

const daily = [
  "BEGIN:VEVENT",
  "UID:daily-1",
  "SUMMARY:Daily del equipo",
  "DTSTART;TZID=America/Bogota:20261102T083000",
  "DTEND;TZID=America/Bogota:20261102T085000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "EXDATE;TZID=America/Bogota:20261104T083000",
  `ATTENDEE;PARTSTAT=ACCEPTED:mailto:${ME}`,
  "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij",
  "ATTACH;FILENAME=Notas - Daily;FMTTYPE=application/vnd.google-apps.document:https://docs.google.com/document/d/x",
  "DESCRIPTION:Tablero: https://dev.azure.com/Org/P/_boards\\nMás info",
  "END:VEVENT",
];
const moved = [
  "BEGIN:VEVENT",
  "UID:daily-1",
  "RECURRENCE-ID;TZID=America/Bogota:20261105T083000",
  "SUMMARY:Daily del equipo (movida)",
  "DTSTART;TZID=America/Bogota:20261105T100000",
  "DTEND;TZID=America/Bogota:20261105T102000",
  "END:VEVENT",
];
const declined = [
  "BEGIN:VEVENT",
  "UID:x-2",
  "SUMMARY:Charla opcional",
  "DTSTART:20261105T200000Z",
  "DTEND:20261105T210000Z",
  `ATTENDEE;PARTSTAT=DECLINED:mailto:${ME}`,
  "END:VEVENT",
];
const cancelled = ["BEGIN:VEVENT", "UID:x-3", "STATUS:CANCELLED", "SUMMARY:Cancelada", "DTSTART:20261105T150000Z", "END:VEVENT"];
const photo = [
  "BEGIN:VEVENT",
  "UID:x-4",
  "SUMMARY:Visita a cliente",
  "DTSTART;VALUE=DATE:20261105",
  "DTEND;VALUE=DATE:20261106",
  "ATTACH;FILENAME=foto.jpg;FMTTYPE=image/jpeg:https://drive.google.com/open?id=foto",
  "END:VEVENT",
];

describe("calendar ics", () => {
  const events = parseIcs(ics([...daily, ...moved, ...declined, ...cancelled, ...photo]), TZ);

  it("convierte hora de pared con zona a UTC", () => {
    expect(new Date(zonedToUtc(2026, 11, 5, 8, 30, 0, TZ)).toISOString()).toBe("2026-11-05T13:30:00.000Z");
  });

  it("recurrencia semanal: aplica EXDATE y la ocurrencia movida", () => {
    expect(eventsOnDate(events, "2026-11-03", TZ, ME).map((e) => `${e.start} ${e.title}`)).toEqual(["08:30 Daily del equipo"]);
    expect(eventsOnDate(events, "2026-11-04", TZ, ME)).toEqual([]); // EXDATE
    const thu = eventsOnDate(events, "2026-11-05", TZ, ME);
    expect(thu.map((e) => `${e.start} ${e.title}`)).toEqual(["todo el día Visita a cliente", "10:00 Daily del equipo (movida)"]);
    expect(eventsOnDate(events, "2026-11-08", TZ, ME)).toEqual([]); // domingo
  });

  it("descarta rechazadas y canceladas; expone Meet, adjuntos (fotos/notas) y enlaces", () => {
    const tue = eventsOnDate(events, "2026-11-03", TZ, ME)[0];
    expect(tue.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(tue.attachments[0]).toMatchObject({ title: "Notas - Daily", mime: "application/vnd.google-apps.document" });
    expect(tue.links).toEqual(["https://dev.azure.com/Org/P/_boards"]);
    expect(tue.myResponse).toBe("ACCEPTED");
    const thu = eventsOnDate(events, "2026-11-05", TZ, ME);
    expect(thu.some((e) => e.title === "Charla opcional" || e.title === "Cancelada")).toBe(false);
    expect(thu[0].attachments[0].mime).toBe("image/jpeg");
  });
});

describe("calendar export", () => {
  function zip(entries: Array<[string, string]>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of entries) {
      const data = deflateRawSync(Buffer.from(text));
      const n = Buffer.from(name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt16LE(n.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt16LE(n.length, 28);
      central.writeUInt32LE(offset, 42);
      locals.push(local, n, data);
      centrals.push(central, n);
      offset += 30 + n.length + data.length;
    }
    const cd = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, eocd]);
  }

  it("lee el ZIP, elige el calendario principal y separa festivos", () => {
    const holiday = ics(["BEGIN:VEVENT", "UID:h1", "SUMMARY:Día festivo demo", "DTSTART;VALUE=DATE:20261105", "END:VEVENT"]);
    const files = unzipEntries(
      zip([
        [`${ME}.ics`, ics([...daily, ...moved])],
        ["Festivos_es#holiday@group.v.calendar.google.com.ics", holiday],
      ]),
    ).map((e) => ({ name: e.name.replace(/\.ics$/, ""), ics: e.data.toString() }));
    expect(primaryCalendar(files)?.name).toBe(ME);
    const day = calendarDay(files, "2026-11-05", { timeZone: TZ });
    expect(day.account).toBe(ME);
    expect(day.holidays).toEqual(["Día festivo demo"]);
    expect(day.events.map((e) => e.title)).toEqual(["Daily del equipo (movida)"]);
  });
});
