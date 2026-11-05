import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { linkyDataDir } from "../security/paths.js";
import type { RiporJournalEntry, RiporMutationOp } from "./types.js";

function journalPath(dataDir?: string): string {
  return path.join(linkyDataDir(dataDir), "ripor-journal.json");
}

export async function loadRiporJournal(dataDir?: string): Promise<RiporJournalEntry[]> {
  try {
    const raw = await readFile(journalPath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as RiporJournalEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveRiporJournal(entries: RiporJournalEntry[], dataDir?: string): Promise<void> {
  const p = journalPath(dataDir);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(entries, null, 2), "utf8");
}

export async function appendRiporJournal(
  entry: Omit<RiporJournalEntry, "id" | "at"> & { id?: string; at?: string },
  dataDir?: string,
): Promise<RiporJournalEntry> {
  const full: RiporJournalEntry = {
    id: entry.id ?? randomUUID(),
    at: entry.at ?? new Date().toISOString(),
    op: entry.op,
    dateYmd: entry.dateYmd,
    status: entry.status,
    snapshotHash: entry.snapshotHash,
    reportId: entry.reportId,
    message: entry.message,
  };
  const all = await loadRiporJournal(dataDir);
  all.push(full);
  await saveRiporJournal(all, dataDir);
  return full;
}

/** Fail-closed: si hay pending/unknown sin reconciliar, bloquear nuevas mutaciones. */
export function riporJournalBlocksMutations(entries: RiporJournalEntry[]): {
  blocked: boolean;
  reason?: string;
} {
  const open = entries.filter((e) => e.status === "pending" || e.status === "unknown");
  if (open.length) {
    return {
      blocked: true,
      reason: `Journal Ripor tiene ${open.length} entrada(s) pending/unknown. Reconciliar UI antes de reintentar (no repetir guardar).`,
    };
  }
  return { blocked: false };
}

export async function reconcileRiporJournalEntry(
  id: string,
  status: "ok" | "failed" | "unknown",
  message?: string,
  dataDir?: string,
): Promise<RiporJournalEntry | undefined> {
  const all = await loadRiporJournal(dataDir);
  const row = all.find((e) => e.id === id);
  if (!row) return undefined;
  row.status = status;
  if (message) row.message = message;
  await saveRiporJournal(all, dataDir);
  return row;
}

export type { RiporMutationOp };
