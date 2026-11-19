/**
 * Pruebas de la web también contra un PostgreSQL real: el servicio postgres de docker-compose (perfil postgres).
 * Crea los secretos si faltan, levanta el contenedor y espera a que esté sano, corre todas las pruebas de la web con
 * LINKY_TEST_DATABASE_URL (base linky_test, rol linky) y, si el contenedor no estaba corriendo, lo detiene al final.
 * Argumentos extra pasan a vitest (p. ej. `npm run web:test:pg -- tests/store.test.ts`).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "..");
const port = process.env.LINKY_PG_PORT ?? "5478";
const secrets = path.resolve(process.env.LINKY_SECRETS_DIR ?? path.join(ROOT, ".secrets"));

const compose = (args, opts = {}) => spawnSync("docker", ["compose", "--profile", "postgres", ...args], { cwd: ROOT, stdio: "inherit", ...opts });
const wasRunning = compose(["ps", "--status", "running", "--quiet", "postgres"], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }).stdout?.trim() !== "";

function stop(code) {
  if (!wasRunning) compose(["stop", "postgres"]);
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(130));

if (spawnSync(process.execPath, [path.join(WEB, "scripts", "docker-init.mjs")], { stdio: "inherit" }).status !== 0) process.exit(1);
if (compose(["up", "--detach", "--wait", "postgres"]).status !== 0) {
  console.error("PostgreSQL no quedó sano. Revisa `docker compose --profile postgres logs postgres`.");
  stop(1);
}

// vitest con el mismo node y sin shell: rutas con espacios (Windows) no se rompen.
const vitest = path.join(WEB, "node_modules", "vitest", "vitest.mjs");
const r = spawnSync(process.execPath, [vitest, "run", ...process.argv.slice(2)], {
  cwd: WEB,
  stdio: "inherit",
  env: {
    ...process.env,
    LINKY_TEST_DATABASE_URL: `postgres://linky@127.0.0.1:${port}/linky_test`,
    LINKY_TEST_DATABASE_PASSWORD_FILE: path.join(secrets, "postgres.password"),
  },
});
stop(r.status ?? 1);
