/** Validación de URLs de evidencia: sin credenciales embebidas. */

export type EvidenceValidation = {
  ok: boolean;
  urls: string[];
  errors: string[];
};

export function validateEvidenceUrls(raw: string[] | string): EvidenceValidation {
  const list = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const errors: string[] = [];
  const urls: string[] = [];
  for (const u of list) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      errors.push(`URL inválida: ${u}`);
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      errors.push(`Protocolo no permitido: ${u}`);
      continue;
    }
    if (parsed.username || parsed.password) {
      errors.push(`URL con credenciales embebidas rechazada: ${parsed.origin}${parsed.pathname}`);
      continue;
    }
    // strip hash noise but keep path/query for evidence
    urls.push(parsed.toString());
  }
  if (urls.length === 0 && errors.length === 0) {
    errors.push("Se requiere al menos un enlace de evidencia válido.");
  }
  return { ok: errors.length === 0 && urls.length > 0, urls, errors };
}
