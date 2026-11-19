/**
 * Crea los secretos de Docker una sola vez, sin imprimirlos, en .secrets/ (ignorado por git y por Docker build) o en
 * LINKY_SECRETS_DIR:
 * - master.key: clave maestra de la web (32 bytes aleatorios), permisos solo para la persona.
 * - postgres-admin.password y postgres.password: contraseñas del administrador de PostgreSQL y del rol de la web.
 *   Van con permisos 0644 dentro de la carpeta 0700: en el anfitrión nadie más entra a la carpeta, y dentro del
 *   contenedor el usuario postgres (uid 999, distinto del de la persona) puede leer el archivo montado.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.resolve(process.env.LINKY_SECRETS_DIR ?? path.join(root, ".secrets"));
mkdirSync(dir, { recursive: true, mode: 0o700 });

const secrets = [
  {
    file: "master.key",
    mode: 0o600,
    value: () => randomBytes(32).toString("base64"),
    exists: "La clave maestra ya existe en %s (no se cambia: cambiarla deja ilegibles los datos cifrados).",
    created: "Clave maestra creada en %s. Respáldala en un lugar seguro: sin ella no se leen los datos.",
  },
  {
    file: "postgres-admin.password",
    mode: 0o644,
    value: () => randomBytes(32).toString("base64url"),
    created: "Contraseña del administrador de PostgreSQL creada en %s.",
  },
  {
    file: "postgres.password",
    mode: 0o644,
    value: () => randomBytes(32).toString("base64url"),
    created: "Contraseña del rol linky de PostgreSQL creada en %s.",
  },
];

for (const s of secrets) {
  const file = path.join(dir, s.file);
  if (existsSync(file)) {
    if (s.exists) console.log(s.exists.replace("%s", file));
    continue;
  }
  writeFileSync(file, s.value(), { mode: s.mode, flag: "wx" });
  console.log(s.created.replace("%s", file));
}
