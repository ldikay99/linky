/**
 * Adjuntos: se guardan cifrados (un archivo por adjunto, AES-256-GCM con la clave de archivos de la persona).
 * Vista previa y extracción de texto para el modelo (Word, Excel, CSV, texto); PDF e imágenes van directo.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FilePreview } from "../../shared/protocol.js";
import type { KeyRing } from "../security/crypto.js";
import type { FileRow, Store } from "../store/db.js";
import { safeName, sniff } from "./sniff.js";

const MAX_ROWS = 2000;
const MAX_COLS = 60;
const MAX_TEXT = 400_000;

export function createFiles(dataDir: string, keys: KeyRing, store: Store) {
  const blobPath = (userId: string, id: string) => path.join(dataDir, "files", userId, `${id}.bin`);

  async function save(userId: string, originalName: string, bytes: Buffer): Promise<FileRow> {
    const kind = sniff(bytes, originalName);
    if (!kind) throw Object.assign(new Error("Tipo de archivo no permitido. Se aceptan imágenes, PDF, Word, Excel, PowerPoint y texto (sin videos)."), { statusCode: 415 });
    const id = randomUUID();
    let name = safeName(originalName);
    if (!/\.[a-z0-9]{1,8}$/i.test(name)) name = `${name}.${kind.ext}`;
    const file = blobPath(userId, id);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, keys.seal(userId, "files", `file:${id}`, bytes), { mode: 0o600 });
    const row: FileRow = { id, userId, name, mediaType: kind.mediaType, kind: kind.kind, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), createdAt: Date.now() };
    store.addFile(row);
    return row;
  }

  async function read(userId: string, id: string): Promise<{ row: FileRow; bytes: Buffer } | null> {
    const row = store.file(userId, id);
    if (!row) return null;
    const bytes = keys.open(userId, "files", `file:${id}`, await readFile(blobPath(userId, id)));
    return { row, bytes };
  }

  async function preview(userId: string, id: string): Promise<FilePreview | null> {
    const f = await read(userId, id);
    if (!f) return null;
    const { row, bytes } = f;
    if (row.mediaType.endsWith("wordprocessingml.document")) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.convertToHtml({ buffer: bytes });
      return { kind: "html", html: value }; // el cliente lo sanea (DOMPurify) antes de mostrarlo
    }
    if (row.mediaType.endsWith("spreadsheetml.sheet")) return { kind: "sheet", sheets: await readSheets(bytes) };
    if (row.kind === "text") {
      const text = bytes.toString("utf8");
      if (row.mediaType === "text/csv" || row.mediaType === "text/tab-separated-values") {
        return { kind: "sheet", sheets: [parseDelimited(text, row.mediaType === "text/csv" ? "," : "\t", row.name)] };
      }
      return { kind: "text", text: text.slice(0, MAX_TEXT), language: path.extname(row.name).slice(1) || "txt", truncated: text.length > MAX_TEXT };
    }
    return { kind: "unsupported", reason: "Este formato no tiene vista previa en el navegador; puedes descargarlo." };
  }

  /** Texto para el modelo cuando el proveedor no lee el formato de forma nativa. */
  async function textFor(userId: string, id: string, limit = 60_000): Promise<string | null> {
    const p = await preview(userId, id);
    if (!p) return null;
    if (p.kind === "html") return p.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, limit);
    if (p.kind === "text") return p.text.slice(0, limit);
    if (p.kind === "sheet") {
      return p.sheets.map((s) => `# ${s.name}\n${s.rows.map((r) => r.join("\t")).join("\n")}`).join("\n\n").slice(0, limit);
    }
    return null;
  }

  return { save, read, preview, textFor };
}

async function readSheets(bytes: Buffer) {
  const { default: readExcelFile } = await import("read-excel-file/node");
  const sheets = (await readExcelFile(bytes)) as Array<{ sheet: string; data: unknown[][] }>;
  return sheets.slice(0, 30).map(({ sheet, data }) => ({
    name: sheet,
    rows: data.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map(cell)),
    truncated: data.length > MAX_ROWS,
  }));
}

function cell(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** CSV/TSV con comillas (RFC 4180) sin dependencias. */
export function parseDelimited(text: string, sep: string, name: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length <= MAX_ROWS; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row.slice(0, MAX_COLS));
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field].slice(0, MAX_COLS));
  return { name, rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}

export type Files = ReturnType<typeof createFiles>;
