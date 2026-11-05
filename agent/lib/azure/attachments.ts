import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { EvidencePolicy } from "../types.js";

export type PreparedAttachment = {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  localPath: string;
  byteLength: number;
};

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function prepareLocalImageAttachment(
  localPath: string,
  policy: EvidencePolicy,
): Promise<PreparedAttachment> {
  if (!policy.allowImages) throw new Error("La política no permite imágenes.");
  const st = await stat(localPath);
  if (st.size > policy.maxImageBytes) {
    throw new Error(`Imagen supera límite de ${policy.maxImageBytes} bytes`);
  }
  const ext = path.extname(localPath).toLowerCase();
  const contentType = EXT_MIME[ext];
  if (!contentType || !policy.allowedImageMime.includes(contentType)) {
    throw new Error(`Tipo de imagen no permitido: ${ext || "(sin extensión)"}`);
  }
  const buf = await readFile(localPath);
  return {
    fileName: path.basename(localPath),
    contentType,
    bytes: new Uint8Array(buf),
    localPath,
    byteLength: buf.byteLength,
  };
}

export function attachmentRelationPatch(attachmentUrl: string, comment?: string): {
  op: string;
  path: string;
  value: { rel: string; url: string; attributes?: { comment?: string } };
} {
  return {
    op: "add",
    path: "/relations/-",
    value: {
      rel: "AttachedFile",
      url: attachmentUrl,
      attributes: comment ? { comment } : undefined,
    },
  };
}

/** Marcador estable embebido para reconciliación (no es secreto). */
export function linkyClientKeyMarker(clientKey: string): string {
  return `<!--linky:clientKey=${clientKey}-->`;
}

export function extractClientKeyFromHtml(html: string): string | null {
  const m = html.match(/<!--linky:clientKey=([^>]+)-->/);
  return m?.[1] ?? null;
}
