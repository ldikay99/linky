/**
 * Estilo de redacción de HU y Tasks que la persona APROBÓ. No se asume: la primera vez la IA propone (a partir de
 * sus HU/Tasks anteriores o de las plantillas genéricas), la persona aprueba o corrige, y desde ahí se reutiliza.
 * Guardado local sin secretos: ~/.linky/azure-style.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { noDatesError } from "../planning/noDates.js";
import { linkyDataDir } from "../security/paths.js";

export type StyleKind = "hu" | "task";
export type ItemStyle = { title?: string; description?: string; example?: string; approvedAt: string };
export type AzureStyle = { version: 1; hu?: ItemStyle; task?: ItemStyle };

const stylePath = (dataDir?: string) => path.join(linkyDataDir(dataDir), "azure-style.json");

export async function loadAzureStyle(dataDir?: string): Promise<AzureStyle> {
  try {
    const s = JSON.parse(await readFile(stylePath(dataDir), "utf8")) as AzureStyle;
    return { version: 1, hu: s.hu, task: s.task };
  } catch {
    return { version: 1 };
  }
}

export async function saveItemStyle(
  kind: StyleKind,
  style: { title?: string; description?: string; example?: string },
  dataDir?: string,
): Promise<AzureStyle> {
  if (!style.title && !style.description && !style.example) throw new Error("Indica al menos --title, --description o --example.");
  for (const text of [style.title, style.description, style.example]) {
    const err = text ? noDatesError(text) : undefined;
    if (err) throw new Error(err.replace("La descripción", "El estilo"));
  }
  const current = await loadAzureStyle(dataDir);
  const next: AzureStyle = { ...current, [kind]: { ...current[kind], ...style, approvedAt: new Date().toISOString() } };
  await mkdir(linkyDataDir(dataDir), { recursive: true, mode: 0o700 });
  await writeFile(stylePath(dataDir), JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return next;
}
