/**
 * Crea la clave maestra de Docker (32 bytes aleatorios) una sola vez, con permisos solo para la persona.
 * Queda en .secrets/ (ignorado por git y por Docker build) o en LINKY_SECRETS_DIR. Nunca se imprime.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.resolve(process.env.LINKY_SECRETS_DIR ?? path.join(root, ".secrets"));
const file = path.join(dir, "master.key");
if (existsSync(file)) {
  console.log(`La clave maestra ya existe en ${file} (no se cambia: cambiarla deja ilegibles los datos cifrados).`);
} else {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  console.log(`Clave maestra creada en ${file}. Respáldala en un lugar seguro: sin ella no se leen los datos.`);
}
