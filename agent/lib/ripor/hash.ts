import { createHash } from "node:crypto";

export function riporSnapshotHash(payload: unknown): string {
  const json = JSON.stringify(payload, (_k, v) => (v === undefined ? null : v));
  return createHash("sha256").update(json).digest("hex").slice(0, 32);
}
