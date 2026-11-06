/** Lector ZIP mínimo (directorio central + deflate) para la exportación de Google Calendar. */
import { inflateRawSync } from "node:zlib";

export function unzipEntries(buf: Buffer): Array<{ name: string; data: Buffer }> {
  // Fin del directorio central (EOCD): firma 0x06054b50, buscando desde el final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP inválido (sin directorio central).");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("ZIP inválido (entrada del directorio).");
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (method !== 0 && method !== 8) throw new Error(`ZIP: método de compresión no soportado (${method}).`);
    out.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
