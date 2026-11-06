import { createHash } from "node:crypto";
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
/**
 * Marcador oculto para reconciliar sin duplicar. Guarda un HASH de la clave (que incluye la fecha),
 * así la descripción nunca contiene fechas.
 */
export function clientKeyToken(clientKey: string): string {
  return createHash("sha256").update(clientKey).digest("hex").slice(0, 16);
}

/** Prefijo neutro del marcador (lo que se busca en la descripción); sin el nombre de la herramienta. */
export const CLIENT_KEY_MARKER_PREFIX = "ref=";

export function linkyClientKeyMarker(clientKey: string): string {
  return `<!--${CLIENT_KEY_MARKER_PREFIX}${clientKeyToken(clientKey)}-->`;
}

export function extractClientKeyFromHtml(html: string): string | null {
  const m = html.match(/<!--(?:ref|linky:k)=([0-9a-f]+)-->/);
  return m?.[1] ?? null;
}
