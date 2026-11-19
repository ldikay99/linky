/**
 * Cifrado de cada columna con contenido de la persona, igual en SQLite y PostgreSQL.
 * La AAD (dato asociado) nombra la columna y el id del registro: un valor copiado a otra fila o columna no abre.
 * Cambiar estos textos deja ilegibles los datos ya guardados.
 */
import type { KeyRing } from "../security/crypto.js";
import type { UiMessage } from "../../shared/protocol.js";
import type { StoredHistory } from "./types.js";

export function sealer(keys: KeyRing) {
  const text = (aad: string) => ({
    seal: (userId: string, id: string, value: string) => keys.seal(userId, "data", `${aad}:${id}`, value),
    open: (userId: string, id: string, sealed: Uint8Array) => keys.open(userId, "data", `${aad}:${id}`, Buffer.from(sealed)).toString("utf8"),
  });
  const json = <T>(aad: string) => ({
    seal: (userId: string, id: string, value: T) => keys.sealJson(userId, `${aad}:${id}`, value),
    open: (userId: string, id: string, sealed: Uint8Array) => keys.openJson<T>(userId, `${aad}:${id}`, Buffer.from(sealed)),
  });
  return {
    title: text("conv-title"),
    transcript: json<UiMessage[]>("conv-transcript"),
    history: json<StoredHistory>("conv-history"),
    fileName: text("file-name"),
    memoryText: text("mem"),
    memoryVector: json<number[]>("mem-vec"),
    approvalInput: json<Record<string, unknown>>("approval"),
  };
}

export type Sealer = ReturnType<typeof sealer>;
