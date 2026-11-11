/** Decodificadores de imágenes que el navegador no muestra solo (TIFF y HEIC/HEIF), cargados bajo demanda. */

async function toBlobUrl(width: number, height: number, rgba: Uint8ClampedArray): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("No se pudo convertir la imagen.");
  return URL.createObjectURL(blob);
}

export async function decodeTiff(buf: ArrayBuffer): Promise<string> {
  const UTIF = (await import("utif2")).default as unknown as {
    decode(b: ArrayBuffer): Array<{ width: number; height: number }>;
    decodeImage(b: ArrayBuffer, ifd: unknown): void;
    toRGBA8(ifd: unknown): Uint8Array;
  };
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error("TIFF vacío.");
  UTIF.decodeImage(buf, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  return toBlobUrl(ifds[0].width, ifds[0].height, new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength));
}

type HeifImage = { get_width(): number; get_height(): number; display(d: ImageData | { data: Uint8ClampedArray; width: number; height: number }, cb: (r: unknown) => void): void };

export async function decodeHeic(buf: ArrayBuffer): Promise<string> {
  const mod = (await import("libheif-js/libheif-wasm/libheif-bundle.mjs")) as unknown as { default: () => { HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } } };
  const lib = mod.default();
  const images = new lib.HeifDecoder().decode(new Uint8Array(buf));
  if (!images.length) throw new Error("HEIC sin imágenes.");
  const img = images[0];
  const width = img.get_width();
  const height = img.get_height();
  const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
  await new Promise<void>((resolve, reject) => img.display(target, (r) => (r ? resolve() : reject(new Error("No se pudo decodificar la imagen HEIC.")))));
  return toBlobUrl(width, height, target.data);
}
