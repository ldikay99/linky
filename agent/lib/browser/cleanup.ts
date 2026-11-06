/**
 * Limpieza de navegadores huérfanos de Linky (p. ej. tras cerrar la terminal a la fuerza).
 * Solo toca procesos que usan EL PERFIL DE LINKY; nunca el navegador personal de la persona.
 * Windows, macOS y Linux.
 */
import { execFileSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";
import { openBrowserCount, sharedBrowserProfileDir } from "./shared.js";

export type OrphanProcess = { pid: number; name: string };

function linkyProfileDirs(dataDir?: string): string[] {
  return [sharedBrowserProfileDir(dataDir), path.join(linkyDataDir(dataDir), "browser-profiles", "google-chat")].map((d) =>
    d.toLowerCase().replace(/\\/g, "/"),
  );
}

/** Lista procesos (pid, nombre, línea de comando) del sistema. */
function listProcesses(): Array<{ pid: number; name: string; cmd: string }> {
  if (process.platform === "win32") {
    const json = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        // Filtro en origen: solo navegadores con perfil explícito (no se leen procesos ajenos).
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe' OR Name='chromium.exe' OR Name='chrome-headless-shell.exe'\" | " +
          "Where-Object { $_.CommandLine -like '*browser-profiles*' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    );
    // Algunas líneas de comando traen caracteres de control crudos: se limpian antes de parsear.
    const clean = (json || "").replace(/[\u0000-\u001f]/g, " ").trim() || "[]";
    const parsed = JSON.parse(clean) as Array<{ ProcessId: number; Name: string; CommandLine: string }> | { ProcessId: number; Name: string; CommandLine: string };
    return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ pid: p.ProcessId, name: p.Name, cmd: p.CommandLine }));
  }
  const out = execFileSync("ps", ["-axo", "pid=,comm=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ pid: Number(m[1]), name: path.basename(m[2]), cmd: m[3] }));
}

/** Procesos de navegador que usan el perfil de Linky (excluye este proceso). */
export function findOrphanBrowsers(dataDir?: string): OrphanProcess[] {
  const dirs = linkyProfileDirs(dataDir);
  return listProcesses()
    .filter((p) => p.pid !== process.pid)
    .filter((p) => /chrome|msedge|chromium|headless_shell/i.test(p.name))
    .filter((p) => {
      const cmd = p.cmd.toLowerCase().replace(/\\/g, "/");
      return dirs.some((d) => cmd.includes(d));
    })
    .map((p) => ({ pid: p.pid, name: p.name }));
}

function killTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    /* ya terminó */
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function cleanupLinkyBrowsers(dataDir?: string): Promise<{ killed: OrphanProcess[]; locksRemoved: string[]; skipped?: string }> {
  if (openBrowserCount() > 0) return { killed: [], locksRemoved: [], skipped: "Este proceso tiene navegadores abiertos." };
  const orphans = findOrphanBrowsers(dataDir);
  for (const o of orphans) killTree(o.pid);
  // Bloqueos que Chrome deja si se cerró a la fuerza (solo si ya no queda ningún proceso del perfil).
  const locksRemoved: string[] = [];
  if (!findOrphanBrowsers(dataDir).length) {
    const profile = sharedBrowserProfileDir(dataDir);
    for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"]) {
      const p = path.join(profile, f);
      if (await exists(p)) {
        await rm(p, { force: true }).catch(() => undefined);
        locksRemoved.push(f);
      }
    }
  }
  return { killed: orphans, locksRemoved };
}
