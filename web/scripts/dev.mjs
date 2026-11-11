/**
 * Desarrollo: servidor API (tsx watch) + Vite con recarga. Al cerrar, se terminan ambos (sin procesos huérfanos).
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = (name) => path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
const env = { ...process.env, NODE_ENV: "development", LINKY_WEB_OPEN_BROWSER: process.env.LINKY_WEB_OPEN_BROWSER ?? "1" };

const children = [
  spawn(bin("tsx"), ["watch", "server/index.ts"], { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" }),
  spawn(bin("vite"), [], { cwd: ROOT, env, stdio: "inherit", shell: process.platform === "win32" }),
];

function stop() {
  for (const c of children) {
    if (c.exitCode !== null || !c.pid) continue;
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      else c.kill("SIGTERM");
    } catch {
      /* ya terminó */
    }
  }
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, stop);
for (const c of children) c.on("exit", stop);
