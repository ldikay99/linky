/**
 * Bienvenida de Linky (logo ASCII + créditos). La IA la muestra al iniciar el onboarding.
 * Color solo en terminal interactiva (respeta NO_COLOR); en salida capturada va en texto plano.
 */
const LOGO = [
  "██╗     ██╗███╗   ██╗██╗  ██╗██╗   ██╗",
  "██║     ██║████╗  ██║██║ ██╔╝╚██╗ ██╔╝",
  "██║     ██║██╔██╗ ██║█████╔╝  ╚████╔╝ ",
  "██║     ██║██║╚██╗██║██╔═██╗   ╚██╔╝  ",
  "███████╗██║██║ ╚████║██║  ██╗   ██║   ",
  "╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝   ╚═╝   ",
];

export function renderBanner(opts?: { color?: boolean }): string {
  const color = opts?.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
  const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  // Degradado azul → turquesa como el logo del README.
  const shades = ["38;5;33", "38;5;33", "38;5;38", "38;5;38", "38;5;43", "38;5;43"];
  const logo = LOGO.map((l, i) => "   " + paint(shades[i], l)).join("\n");
  const lines = [
    "",
    logo,
    "",
    "   " + paint("1", "Tu día de trabajo, reportado por tu IA"),
    "   " + paint("2", "Azure DevOps  ·  Ripor  ·  Windows · macOS · Linux"),
    "",
    "   " + paint("38;5;43", "por Jonathan Contreras"),
    "",
    "   Sin API keys: funciona con el asistente de IA que prefieras.",
    "   Tus credenciales se quedan en el llavero de tu equipo.",
    "",
    "   Onboarding:",
    "     1. Azure DevOps   →  azure connect --org <url> --primary   (PAT Full access · 90 días)",
    "     2. Google         →  google login   (Chat, Calendar, Gmail y Ripor con Google)",
    "     3. Ripor          →  ripor login  ·  ripor catalog  ·  ripor setup",
    "     4. Revisión       →  doctor",
    "     5. Tu día         →  \"registra mi día con lo que hice en Azure\"",
    "",
    "   Opcional:  chat login (inicio/cierre en Google Chat)  ·  dev scan (si desarrollas)",
    "",
  ];
  return lines.join("\n");
}
