/**
 * Detecta el tipo REAL de un archivo por su contenido (no por la extensión ni por lo que diga el navegador).
 * Solo se aceptan imágenes, PDF, Word, Excel, PowerPoint y texto; videos, audio y ejecutables se rechazan.
 */
import type { FileKind } from "../../shared/protocol.js";

export type Sniffed = { mediaType: string; kind: FileKind; ext: string };

const startsWith = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString("latin1");

const TEXT_EXT: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  log: "text/plain",
  xml: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  sql: "text/plain",
  html: "text/plain", // se muestra como texto, nunca se interpreta
};

function extOf(name: string) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function isUtf8Text(b: Buffer): boolean {
  const sample = b.subarray(0, Math.min(b.length, 64 * 1024));
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length < b.length ? sample.subarray(0, sample.lastIndexOf(0x0a) + 1 || sample.length) : sample);
    return true;
  } catch {
    return false;
  }
}

export function sniff(b: Buffer, name: string): Sniffed | null {
  const ext = extOf(name);
  if (b.length < 4) return isUtf8Text(b) && TEXT_EXT[ext] ? { mediaType: TEXT_EXT[ext], kind: "text", ext } : null;

  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return { mediaType: "image/png", kind: "image", ext: "png" };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { mediaType: "image/jpeg", kind: "image", ext: "jpg" };
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return { mediaType: "image/gif", kind: "image", ext: "gif" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return { mediaType: "image/webp", kind: "image", ext: "webp" };
  if (ascii(b, 0, 2) === "BM" && b.length > 26) return { mediaType: "image/bmp", kind: "image", ext: "bmp" };
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return { mediaType: "image/tiff", kind: "image", ext: "tiff" };
  if (startsWith(b, [0x00, 0x00, 0x01, 0x00])) return { mediaType: "image/x-icon", kind: "image", ext: "ico" };
  if (ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    const brands = ascii(b, 8, Math.min(b.length, 64));
    if (brand === "avif" || brand === "avis") return { mediaType: "image/avif", kind: "image", ext: "avif" };
    if (["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(brand) || /heic|mif1/.test(brands)) {
      return { mediaType: "image/heic", kind: "image", ext: "heic" };
    }
    return null; // mp4, mov, 3gp…: videos no se aceptan
  }
  if (ascii(b, 0, 5) === "%PDF-") return { mediaType: "application/pdf", kind: "pdf", ext: "pdf" };

  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    // OOXML: los nombres de las partes viajan en claro dentro del zip.
    const names = b.toString("latin1");
    if (names.includes("word/document.xml")) return { mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "word", ext: "docx" };
    if (names.includes("xl/workbook.xml")) return { mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "sheet", ext: "xlsx" };
    if (names.includes("ppt/presentation.xml")) return { mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "slides", ext: "pptx" };
    return null; // otros zip: no
  }
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // Office 97-2003: el contenedor no dice el tipo; se toma de la extensión entre los permitidos.
    if (ext === "doc") return { mediaType: "application/msword", kind: "word", ext };
    if (ext === "xls") return { mediaType: "application/vnd.ms-excel", kind: "sheet", ext };
    if (ext === "ppt") return { mediaType: "application/vnd.ms-powerpoint", kind: "slides", ext };
    return null;
  }

  if (isUtf8Text(b)) {
    const head = b.subarray(0, 2048).toString("utf8").trimStart().toLowerCase();
    if (ext === "svg" || head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
      return { mediaType: "image/svg+xml", kind: "image", ext: "svg" };
    }
    if (TEXT_EXT[ext]) return { mediaType: TEXT_EXT[ext], kind: "text", ext };
    return { mediaType: "text/plain", kind: "text", ext: ext || "txt" };
  }
  return null;
}

/** Audio para dictado (solo el endpoint de transcripción lo acepta; nunca se guarda). */
export function sniffAudio(b: Buffer): string | null {
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  if (ascii(b, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(b, 4, 8) === "ftyp") return "audio/mp4";
  if (ascii(b, 0, 3) === "ID3" || startsWith(b, [0xff, 0xfb])) return "audio/mpeg";
  return null;
}

/** Nombre seguro para mostrar o guardar: sin rutas, sin caracteres de control, longitud acotada. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "archivo";
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim().slice(0, 160);
  return clean || "archivo";
}
