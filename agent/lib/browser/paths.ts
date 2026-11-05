import { homedir } from "node:os";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";

/** Perfil de navegador persistente FUERA del repo. No guarda cookies en el código. */
export function riporBrowserProfileDir(dataDir?: string): string {
  return linkyDataDir(path.join(linkyDataDir(dataDir), "browser-profiles", "ripor"));
}

export function defaultRiporBrowserProfileHint(): string {
  return path.join(homedir(), ".linky", "browser-profiles", "ripor");
}
