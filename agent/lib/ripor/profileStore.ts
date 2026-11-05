import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";
import { assertNoSecretInObject } from "../security/secrets.js";
import type { RiporProfile } from "./types.js";
import { emptyRiporProfile } from "./setup.js";

export function riporProfilePath(dataDir?: string): string {
  return path.join(linkyDataDir(dataDir), "ripor-profile.json");
}

export async function loadRiporProfile(dataDir?: string): Promise<RiporProfile | null> {
  try {
    const raw = await readFile(riporProfilePath(dataDir), "utf8");
    return JSON.parse(raw) as RiporProfile;
  } catch {
    return null;
  }
}

export async function saveRiporProfile(profile: RiporProfile, dataDir?: string): Promise<string> {
  assertNoSecretInObject(profile);
  const dir = linkyDataDir(dataDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const p = riporProfilePath(dataDir);
  await writeFile(p, JSON.stringify(profile, null, 2), { encoding: "utf8", mode: 0o600 });
  return p;
}

export async function loadOrEmptyRiporProfile(dataDir?: string): Promise<RiporProfile> {
  return (await loadRiporProfile(dataDir)) ?? emptyRiporProfile();
}
