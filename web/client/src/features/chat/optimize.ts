/**
 * Imágenes grandes se reescalan en el navegador antes de subir (máx. 2560 px por lado): suben en segundos, el visor
 * abre al instante y caben en los límites de imagen de los proveedores de IA. Si no hay ganancia, se sube el original.
 */
const MAX_SIDE = 2560;
const SMALL_ENOUGH = 2.5 * 1024 * 1024;
const RESIZABLE = /^image\/(jpeg|png|webp|bmp|avif)$/;

export async function optimizeImage(file: File): Promise<{ file: File; optimized: boolean }> {
  if (!RESIZABLE.test(file.type) || typeof createImageBitmap === "undefined") return { file, optimized: false };
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { file, optimized: false };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size <= SMALL_ENOUGH) {
    bmp.close();
    return { file, optimized: false };
  }
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  // PNG puede tener transparencia: WebP la conserva; lo demás va a JPEG.
  const type = file.type === "image/png" ? "image/webp" : "image/jpeg";
  let blob: Blob | null = null;
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      blob = await c.convertToBlob({ type, quality: 0.86 });
    } else {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.86));
    }
  } finally {
    bmp.close();
  }
  if (!blob || blob.size >= file.size) return { file, optimized: false };
  const name = file.name.replace(/\.[a-z0-9]{1,8}$/i, "") + (type === "image/webp" ? ".webp" : ".jpg");
  return { file: new File([blob], name, { type, lastModified: file.lastModified }), optimized: true };
}
