/**
 * Qué eventos del calendario son REUNIONES DE TRABAJO de la persona. No todo evento lo es (pausas activas,
 * charlas, avisos): solo cuenta lo que la persona confirmó. Lo no clasificado se pregunta, nunca se asume.
 * Guardado local sin secretos: ~/.linky/calendar.json (coincidencia por texto del título, sin mayúsculas/tildes).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";

export type MeetingRules = { version: 1; meetings: string[]; ignore: string[] };

const rulesPath = (dataDir?: string) => path.join(linkyDataDir(dataDir), "calendar.json");

export function normalizeTitle(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export async function loadMeetingRules(dataDir?: string): Promise<MeetingRules> {
  try {
    const r = JSON.parse(await readFile(rulesPath(dataDir), "utf8")) as MeetingRules;
    return { version: 1, meetings: r.meetings ?? [], ignore: r.ignore ?? [] };
  } catch {
    return { version: 1, meetings: [], ignore: [] };
  }
}

export async function addMeetingRule(kind: "meetings" | "ignore", title: string, dataDir?: string): Promise<MeetingRules> {
  const pattern = normalizeTitle(title);
  if (pattern.length < 3) throw new Error("--title demasiado corto (mínimo 3 letras).");
  const rules = await loadMeetingRules(dataDir);
  const other = kind === "meetings" ? "ignore" : "meetings";
  rules[other] = rules[other].filter((p) => p !== pattern);
  if (!rules[kind].includes(pattern)) rules[kind].push(pattern);
  await mkdir(linkyDataDir(dataDir), { recursive: true, mode: 0o700 });
  await writeFile(rulesPath(dataDir), JSON.stringify(rules, null, 2), { encoding: "utf8", mode: 0o600 });
  return rules;
}

/** true = reunión confirmada, false = ignorada, null = sin confirmar (preguntar). */
export function classifyEvent(title: string, rules: MeetingRules): boolean | null {
  const t = normalizeTitle(title);
  if (rules.ignore.some((p) => t.includes(p))) return false;
  if (rules.meetings.some((p) => t.includes(p))) return true;
  return null;
}
