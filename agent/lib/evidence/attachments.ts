import { stat } from "node:fs/promises";
import path from "node:path";
import type { EvidencePolicy } from "../types.js";

const URL_RE = /^https?:\/\/\S+$/i;

export type EvidenceCheck = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function validateLinks(links: string[], policy: EvidencePolicy): EvidenceCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!policy.allowLinks && links.length) errors.push("La política no permite enlaces.");
  for (const link of links) {
    if (!URL_RE.test(link)) errors.push(`Enlace inválido: ${link}`);
    if (/token=|sig=|sharedaccesssignature|password=/i.test(link)) {
      errors.push("El enlace parece contener secreto/firma; no lo adjuntes tal cual.");
    }
  }
  if (policy.requireAccessNote && links.length) {
    warnings.push("Anota si el enlace es público, privado o requiere acceso de equipo.");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export async function validateImages(pathsOrUrls: string[], policy: EvidencePolicy): Promise<EvidenceCheck> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!policy.allowImages && pathsOrUrls.length) errors.push("La política no permite imágenes.");
  for (const item of pathsOrUrls) {
    if (URL_RE.test(item)) {
      warnings.push(`Imagen por URL: verifica tamaño/tipo al descargar (${item})`);
      continue;
    }
    try {
      const st = await stat(item);
      if (st.size > policy.maxImageBytes) {
        errors.push(`Imagen supera ${policy.maxImageBytes} bytes: ${item}`);
      }
      const ext = path.extname(item).toLowerCase();
      const mimeGuess =
        ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "unknown";
      if (mimeGuess === "unknown" || !policy.allowedImageMime.includes(mimeGuess)) {
        errors.push(`Tipo de imagen no permitido (${ext || "sin extensión"}): ${item}`);
      }
    } catch {
      errors.push(`No se pudo leer la imagen local: ${item}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** No inventa evidencia: si no hay, el plan debe preguntar. */
export function evidenceMissing(activity: { evidenceLinks: string[]; evidenceImages: string[]; meetingOrCallLinks: string[] }): boolean {
  return activity.evidenceLinks.length + activity.evidenceImages.length + activity.meetingOrCallLinks.length === 0;
}
