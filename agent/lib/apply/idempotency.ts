import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { idempotencyPath, linkyDataDir } from "../security/paths.js";
import type { ApplyPreview, PlannedChange } from "../types.js";

export type JournalStatus = "pending" | "completed" | "unknown" | "failed" | "reconciled";

export type JournalRecord = {
  key: string;
  status: JournalStatus;
  action: string;
  workItemId?: number;
  at: string;
  updatedAt: string;
  previewSnapshotHash: string;
  note?: string;
};

type Store = { records: JournalRecord[] };

async function load(dataDir?: string): Promise<Store> {
  try {
    return JSON.parse(await readFile(idempotencyPath(dataDir), "utf8")) as Store;
  } catch {
    return { records: [] };
  }
}

async function save(store: Store, dataDir?: string): Promise<void> {
  await mkdir(linkyDataDir(dataDir), { recursive: true, mode: 0o700 });
  await writeFile(idempotencyPath(dataDir), JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function buildClientKey(parts: Array<string | number | undefined>): string {
  return parts.filter((p) => p !== undefined && p !== "").join("::");
}

/** Hash canónico del preview (cambios) para congelar la aprobación. */
export function hashPreviewSnapshot(preview: Pick<ApplyPreview, "changes" | "generatedAt">): string {
  const canonical = JSON.stringify({
    generatedAt: preview.generatedAt,
    changes: preview.changes,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function getJournal(key: string, dataDir?: string): Promise<JournalRecord | undefined> {
  const store = await load(dataDir);
  return store.records.find((r) => r.key === key);
}

export async function writeJournal(rec: JournalRecord, dataDir?: string): Promise<void> {
  const store = await load(dataDir);
  const idx = store.records.findIndex((r) => r.key === rec.key);
  if (idx >= 0) store.records[idx] = rec;
  else store.records.push(rec);
  await save(store, dataDir);
}

/**
 * Marca pending ANTES de la request. Si ya hay pending/unknown, fail-closed.
 */
export async function beginPending(args: {
  key: string;
  action: string;
  previewSnapshotHash: string;
  dataDir?: string;
}): Promise<JournalRecord> {
  const existing = await getJournal(args.key, args.dataDir);
  if (existing?.status === "completed" || existing?.status === "reconciled") {
    return existing;
  }
  if (existing?.status === "pending" || existing?.status === "unknown") {
    throw new Error(
      `FAIL_CLOSED:${args.key}: estado journal=${existing.status}. ` +
        `No se reintenta automáticamente. Ejecute reconcileClientKey antes de continuar.`,
    );
  }
  const now = new Date().toISOString();
  const rec: JournalRecord = {
    key: args.key,
    status: "pending",
    action: args.action,
    at: existing?.at ?? now,
    updatedAt: now,
    previewSnapshotHash: args.previewSnapshotHash,
  };
  await writeJournal(rec, args.dataDir);
  return rec;
}

export async function markCompleted(
  key: string,
  workItemId: number,
  dataDir?: string,
): Promise<void> {
  const existing = await getJournal(key, dataDir);
  if (!existing) throw new Error(`Journal missing for ${key}`);
  await writeJournal(
    {
      ...existing,
      status: "completed",
      workItemId,
      updatedAt: new Date().toISOString(),
    },
    dataDir,
  );
}

export async function markUnknown(key: string, note: string, dataDir?: string): Promise<void> {
  const existing = await getJournal(key, dataDir);
  if (!existing) throw new Error(`Journal missing for ${key}`);
  await writeJournal(
    {
      ...existing,
      status: "unknown",
      note,
      updatedAt: new Date().toISOString(),
    },
    dataDir,
  );
}

export async function markFailed(key: string, note: string, dataDir?: string): Promise<void> {
  const existing = await getJournal(key, dataDir);
  if (!existing) throw new Error(`Journal missing for ${key}`);
  await writeJournal(
    {
      ...existing,
      status: "failed",
      note,
      updatedAt: new Date().toISOString(),
    },
    dataDir,
  );
}

export async function markReconciled(key: string, workItemId: number, dataDir?: string): Promise<void> {
  const existing = await getJournal(key, dataDir);
  const now = new Date().toISOString();
  await writeJournal(
    {
      key,
      status: "reconciled",
      action: existing?.action ?? "reconcile",
      workItemId,
      at: existing?.at ?? now,
      updatedAt: now,
      previewSnapshotHash: existing?.previewSnapshotHash ?? "",
      note: "reconciled via marker/WIQL",
    },
    dataDir,
  );
}

export function isUncertainError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err);
  return (
    /SIMULATED_RESPONSE_LOSS|timeout|ECONNRESET|network|fetch failed|aborted|UND_ERR/i.test(msg) ||
    /respuesta falló|uncertain|unknown/i.test(msg)
  );
}

export type { PlannedChange };
