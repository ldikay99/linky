import { readFile } from "node:fs/promises";
import type { AzureClient } from "../azure/client.js";
import { attachmentRelationPatch, prepareLocalImageAttachment } from "../azure/attachments.js";
import { fieldsToJsonPatch } from "../azure/fields.js";
import type { ApplyPreview, ApplyResult, LinkyProfile } from "../types.js";
import {
  beginPending,
  getJournal,
  hashPreviewSnapshot,
  isUncertainError,
  markCompleted,
  markFailed,
  markReconciled,
  markUnknown,
} from "./idempotency.js";
import { enforcePoliciesOnChange } from "./policy.js";

export type ApplyAuthorization = {
  approved: true;
  approvedBy: string;
  /** Debe coincidir con preview.snapshotHash */
  approvedSnapshotHash: string;
  note?: string;
};

export type ApplyOptions = {
  dataDir?: string;
  profile: LinkyProfile;
};

/**
 * Aplica cambios solo con autorización explícita + snapshot congelado.
 * Journal durable: pending ANTES del request; unknown bloquea reintento.
 * No usa headers inventados de idempotencia Azure.
 */
export async function applyPreview(
  client: AzureClient,
  preview: ApplyPreview,
  auth: ApplyAuthorization,
  options: ApplyOptions,
): Promise<ApplyResult> {
  if (auth.approved !== true) throw new Error("Apply denegado: se requiere approved: true explícito.");
  if (!auth.approvedBy?.trim()) throw new Error("Apply denegado: falta approvedBy.");

  const currentHash = hashPreviewSnapshot(preview);
  if (!preview.snapshotHash || preview.snapshotHash !== currentHash) {
    throw new Error("Apply denegado: snapshotHash del preview no coincide con su contenido (posible edición).");
  }
  if (auth.approvedSnapshotHash !== preview.snapshotHash) {
    throw new Error("Apply denegado: approvedSnapshotHash no coincide con el preview aprobado.");
  }

  const result: ApplyResult = {
    applied: [],
    skippedIdempotent: [],
    blocked: [],
    errors: [],
    needsReconcile: [],
  };

  for (const change of preview.changes) {
    const policy = enforcePoliciesOnChange(options.profile, change);
    if (!policy.ok) {
      result.blocked.push({ clientKey: change.clientKey, reason: policy.reason });
      continue;
    }

    const existing = await getJournal(change.clientKey, options.dataDir);
    if (existing?.status === "completed" || existing?.status === "reconciled") {
      result.skippedIdempotent.push(change.clientKey);
      continue;
    }
    if (existing?.status === "pending" || existing?.status === "unknown") {
      result.needsReconcile.push(change.clientKey);
      result.blocked.push({
        clientKey: change.clientKey,
        reason: `Journal ${existing.status}: reconcilie antes de reintentar (fail-closed).`,
      });
      continue;
    }

    try {
      await beginPending({
        key: change.clientKey,
        action: change.op,
        previewSnapshotHash: preview.snapshotHash,
        dataDir: options.dataDir,
      });
    } catch (e) {
      result.blocked.push({ clientKey: change.clientKey, reason: (e as Error).message });
      result.needsReconcile.push(change.clientKey);
      continue;
    }

    try {
      if (change.op === "create") {
        const patch = fieldsToJsonPatch(change.fields);
        if (change.relations?.length) {
          for (const rel of change.relations) {
            patch.push({ op: "add", path: "/relations/-", value: { rel: rel.rel, url: rel.url } });
          }
        }
        // Adjuntos: subir primero y añadir AttachedFile al create
        if (change.attachments?.length) {
          for (const att of change.attachments) {
            const prepared = await prepareLocalImageAttachment(att.localPath, options.profile.evidence);
            const uploaded = await client.uploadAttachment(prepared.fileName, prepared.contentType, prepared.bytes);
            patch.push(attachmentRelationPatch(uploaded.url, "Evidencia"));
          }
        }
        const item = await client.createWorkItem(String(change.workItemType), patch);
        await markCompleted(change.clientKey, item.id, options.dataDir);
        result.applied.push({ clientKey: change.clientKey, workItemId: item.id, action: "create" });
      } else if (change.op === "update") {
        const patch = fieldsToJsonPatch(change.fields);
        if (change.comment) {
          patch.push({ op: "add", path: "/fields/System.History", value: change.comment });
        }
        if (change.relations?.length) {
          for (const rel of change.relations) {
            patch.push({ op: "add", path: "/relations/-", value: { rel: rel.rel, url: rel.url } });
          }
        }
        if (change.attachments?.length) {
          for (const att of change.attachments) {
            const bytes = new Uint8Array(await readFile(att.localPath));
            const prepared = await prepareLocalImageAttachment(att.localPath, options.profile.evidence);
            void bytes;
            const uploaded = await client.uploadAttachment(prepared.fileName, prepared.contentType, prepared.bytes);
            patch.push(attachmentRelationPatch(uploaded.url, "Evidencia"));
          }
        }
        const item = await client.updateWorkItem(change.workItemId, patch, {
          ifMatchRev: change.expectedRev,
        });
        await markCompleted(change.clientKey, item.id, options.dataDir);
        result.applied.push({ clientKey: change.clientKey, workItemId: item.id, action: "update" });
      } else {
        const patch = [{ op: "add", path: "/fields/System.State", value: change.toState }];
        if (change.comment) patch.push({ op: "add", path: "/fields/System.History", value: change.comment });
        const item = await client.updateWorkItem(change.workItemId, patch, {
          ifMatchRev: change.expectedRev,
        });
        await markCompleted(change.clientKey, item.id, options.dataDir);
        result.applied.push({
          clientKey: change.clientKey,
          workItemId: item.id,
          action: `transition:${change.toState}`,
        });
      }
    } catch (e) {
      if (isUncertainError(e)) {
        await markUnknown(change.clientKey, (e as Error).message, options.dataDir);
        result.needsReconcile.push(change.clientKey);
        result.errors.push({
          clientKey: change.clientKey,
          message: `Respuesta incierta: ${(e as Error).message}. NO se reintenta. Use reconcile.`,
        });
      } else {
        await markFailed(change.clientKey, (e as Error).message, options.dataDir);
        result.errors.push({ clientKey: change.clientKey, message: (e as Error).message });
      }
    }
  }

  return result;
}

/** Reconcilia un clientKey buscando el marcador en Description vía WIQL/mock. */
export async function reconcileClientKey(
  client: AzureClient,
  clientKey: string,
  dataDir?: string,
): Promise<{ workItemId: number | null; status: string }> {
  const ids = await client.queryByClientKeyMarker(clientKey);
  if (ids.length === 1) {
    await markReconciled(clientKey, ids[0], dataDir);
    return { workItemId: ids[0], status: "reconciled" };
  }
  if (ids.length > 1) {
    return { workItemId: null, status: `ambiguous:${ids.join(",")}` };
  }
  const journal = await getJournal(clientKey, dataDir);
  if (journal?.status === "unknown" || journal?.status === "pending") {
    return { workItemId: null, status: "not_found_still_uncertain" };
  }
  return { workItemId: null, status: "not_found" };
}
