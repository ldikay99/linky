/** Reglas puras del flujo de contribución (rama por persona, fork si no tiene escritura). */

/** "Arreglo evidencia Ripor!" → "arreglo-evidencia-ripor" (ASCII, sin tildes, máx. 40). */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Rama de la persona: contrib/<login>/<tema>. Si ya está en una rama suya, se reutiliza. */
export function contribBranch(login: string, topic: string, currentBranch: string): string {
  const user = slugify(login) || "anon";
  if (currentBranch.startsWith(`contrib/${user}/`)) return currentBranch;
  const slug = slugify(topic);
  if (!slug) throw new Error("--topic es obligatorio (tema corto del cambio).");
  return `contrib/${user}/${slug}`;
}

/** Con escritura en el repo se empuja la rama ahí; si no, a un fork propio. */
export function needsFork(viewerPermission: string | undefined): boolean {
  return !["ADMIN", "MAINTAIN", "WRITE"].includes(String(viewerPermission ?? "").toUpperCase());
}

export function prBody(input: { summary: string; checks: Array<{ name: string; ok: boolean }>; author: string }): string {
  return [
    "## Qué cambia",
    "",
    input.summary.trim() || "(describir)",
    "",
    "## Validación",
    "",
    ...input.checks.map((c) => `- [${c.ok ? "x" : " "}] ${c.name}`),
    "",
    "## Checklist",
    "",
    "- [x] Sin credenciales, tokens, cookies ni datos personales (escáner en verde)",
    "- [x] Ejemplos y tests solo con datos sintéticos",
    "- [ ] Probado con cuentas reales (indicar qué se probó)",
    "",
    `Rama de @${input.author}. Requiere aprobación del mantenedor antes de integrarse.`,
  ].join("\n");
}
