/**
 * Descarga los adjuntos de Drive de las reuniones (fotos, notas/transcripciones como PDF, chat) con la sesión
 * de Google del perfil de Linky, en headless. Destino local fuera del repo (~/.linky/evidence/<fecha>/).
 */
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { openSharedBrowser, safeBrowserError } from "../browser/shared.js";
import { linkyDataDir } from "../security/paths.js";
import type { IcsAttachment } from "./ics.js";

export type AttachmentKind = "image" | "doc" | "text" | "video" | "other";

export function attachmentKind(a: IcsAttachment): AttachmentKind {
  const m = a.mime ?? "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("application/vnd.google-apps.") || m === "application/pdf") return "doc";
  if (m.startsWith("text/")) return "text";
  return "other";
}

/** ID de Drive desde las formas habituales de enlace. */
export function driveFileId(url: string): string | undefined {
  return (
    /[?&]id=([\w-]{10,})/.exec(url)?.[1] ??
    /\/(?:file|document|spreadsheets|presentation)\/d\/([\w-]{10,})/.exec(url)?.[1]
  );
}

/** URL de descarga: Google Docs/Sheets/Slides se exportan a PDF; el resto, archivo original. */
export function downloadUrl(a: IcsAttachment): string | undefined {
  const id = driveFileId(a.url);
  if (!id) return undefined;
  const m = a.mime ?? "";
  if (m.endsWith(".document")) return `https://docs.google.com/document/d/${id}/export?format=pdf`;
  if (m.endsWith(".spreadsheet")) return `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`;
  if (m.endsWith(".presentation")) return `https://docs.google.com/presentation/d/${id}/export/pdf`;
  return `https://drive.google.com/uc?export=download&id=${id}`;
}

function safeName(title: string | undefined, fallback: string, ext: string): string {
  const base = (title ?? fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 90) || fallback;
  return path.extname(base) ? base : `${base}${ext}`;
}

export type DownloadedEvidence = { meeting: string; kind: AttachmentKind; title?: string; path?: string; bytes?: number; error?: string; source: string };

export async function downloadMeetingAttachments(input: {
  dateYmd: string;
  items: Array<{ meeting: string; attachment: IcsAttachment }>;
  kinds: AttachmentKind[];
  maxBytes?: number;
  dataDir?: string;
}): Promise<DownloadedEvidence[]> {
  const dir = path.join(linkyDataDir(input.dataDir), "evidence", input.dateYmd);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const wanted = input.items.filter((i) => input.kinds.includes(attachmentKind(i.attachment)));
  if (!wanted.length) return [];
  const maxBytes = input.maxBytes ?? 25 * 1024 * 1024;
  const results: DownloadedEvidence[] = [];
  const context = await openSharedBrowser({ headless: true, dataDir: input.dataDir });
  try {
    for (const { meeting, attachment } of wanted) {
      const kind = attachmentKind(attachment);
      const base: DownloadedEvidence = { meeting, kind, title: attachment.title, source: attachment.url };
      const url = downloadUrl(attachment);
      if (!url) {
        results.push({ ...base, error: "Enlace sin ID de Drive" });
        continue;
      }
      const page = await context.newPage();
      try {
        const downloadP = page.waitForEvent("download", { timeout: 45_000 });
        downloadP.catch(() => undefined);
        // Texto/imagen pequeños pueden servirse en línea (sin evento de descarga): se guardan directo.
        const inline = await page.goto(url).catch(() => null);
        if (inline && (inline.status() === 403 || inline.status() === 404)) {
          results.push({ ...base, error: inline.status() === 403 ? "Sin acceso al archivo (permiso del organizador)" : "Archivo no encontrado" });
          continue;
        }
        const ctype = inline?.headers()["content-type"] ?? "";
        if (inline?.ok() && ctype && !/text\/html/i.test(ctype)) {
          const body = await inline.body();
          const ext = ctype.startsWith("text/plain") ? ".txt" : ctype.includes("pdf") ? ".pdf" : "";
          if (body.length > maxBytes) {
            results.push({ ...base, bytes: body.length, error: `Supera el tope (${Math.round(maxBytes / 1048576)} MB)` });
          } else {
            const target = path.join(dir, safeName(attachment.title, "adjunto", ext));
            await writeFile(target, body, { mode: 0o600 });
            results.push({ ...base, path: target, bytes: body.length });
          }
          continue;
        }
        // Archivos grandes: Drive muestra aviso de "no se pudo analizar"; se confirma la descarga.
        const confirm = page.locator("form#download-form, #uc-download-link").first();
        if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await page.locator('form#download-form [type="submit"], #uc-download-link').first().click().catch(() => undefined);
        }
        const download = await downloadP;
        const ext = path.extname(download.suggestedFilename()) || (url.includes("format=pdf") || url.endsWith("/pdf") ? ".pdf" : "");
        const target = path.join(dir, safeName(attachment.title, download.suggestedFilename() || "adjunto", ext));
        const tmp = await download.path();
        const size = tmp ? (await stat(tmp)).size : 0;
        if (size > maxBytes) {
          results.push({ ...base, bytes: size, error: `Supera el tope (${Math.round(maxBytes / 1048576)} MB)` });
        } else {
          await copyFile(tmp!, target);
          results.push({ ...base, path: target, bytes: size });
        }
      } catch (e) {
        results.push({ ...base, error: safeBrowserError(e, "descarga").message });
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await context.close().catch(() => undefined);
  }
  return results;
}
