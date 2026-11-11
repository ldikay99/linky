import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Attachment, FilePreview } from "../../../../shared/protocol";
import { api } from "../../api";
import { Icon, kindIcon } from "../../ui/icons";
import { sanitize } from "../../ui/Markdown";
import { IconButton, Overlay, Spinner, formatBytes } from "../../ui/primitives";

const NATIVE_IMG = /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon)$/;

function useZoom() {
  const [scale, setScale] = useState(1);
  const [rot, setRot] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const clamp = (s: number) => Math.min(8, Math.max(0.2, s));
  return {
    scale,
    rot,
    pos,
    zoom: (f: number) => setScale((s) => clamp(s * f)),
    reset: () => {
      setScale(1);
      setPos({ x: 0, y: 0 });
      setRot(0);
    },
    rotate: () => setRot((r) => (r + 90) % 360),
    onWheel: (e: React.WheelEvent) => setScale((s) => clamp(s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))),
    onDown: (e: ReactPointerEvent) => {
      (e.target as Element).setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    },
    onMove: (e: ReactPointerEvent) => {
      if (!drag.current) return;
      setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
    },
    onUp: () => {
      drag.current = null;
    },
  };
}

function ImageView({ att }: { att: Attachment }) {
  const [src, setSrc] = useState<string | null>(NATIVE_IMG.test(att.mediaType) ? api.fileUrl(att.id) : null);
  const [error, setError] = useState<string | null>(null);
  const z = useZoom();
  useEffect(() => {
    if (NATIVE_IMG.test(att.mediaType)) return;
    let url: string | null = null;
    let alive = true;
    (async () => {
      try {
        const buf = await (await fetch(api.fileUrl(att.id), { credentials: "same-origin" })).arrayBuffer();
        const { decodeHeic, decodeTiff } = await import("./decoders");
        url = att.mediaType === "image/tiff" ? await decodeTiff(buf) : await decodeHeic(buf);
        if (alive) setSrc(url);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [att]);
  return (
    <div className="v-image">
      <div className="v-image__stage" onWheel={z.onWheel} onPointerDown={z.onDown} onPointerMove={z.onMove} onPointerUp={z.onUp} onDoubleClick={z.reset}>
        {error ? (
          <p className="muted">{error}</p>
        ) : src ? (
          <img src={src} alt={att.name} draggable={false} style={{ transform: `translate(${z.pos.x}px, ${z.pos.y}px) scale(${z.scale}) rotate(${z.rot}deg)` }} />
        ) : (
          <Spinner size={26} />
        )}
      </div>
      <div className="v-toolbar">
        <IconButton icon="zoomOut" label="Alejar" onClick={() => z.zoom(1 / 1.25)} />
        <span className="v-toolbar__value">{Math.round(z.scale * 100)}%</span>
        <IconButton icon="zoomIn" label="Acercar" onClick={() => z.zoom(1.25)} />
        <span className="v-toolbar__sep" />
        <IconButton icon="rotate" label="Rotar" onClick={z.rotate} />
        <IconButton icon="fit" label="Ajustar" onClick={z.reset} />
      </div>
    </div>
  );
}

type PdfDoc = { numPages: number; getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas?: HTMLCanvasElement }): { promise: Promise<void>; cancel(): void } }>; destroy(): Promise<void> };

function PdfPage({ doc, n, scale }: { doc: PdfDoc; n: number; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(n <= 2);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let task: { cancel(): void } | null = null;
    let alive = true;
    void doc.getPage(n).then((page) => {
      if (!alive || !canvas.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvas.current;
      c.width = vp.width;
      c.height = vp.height;
      c.style.width = `${vp.width / dpr}px`;
      c.style.height = `${vp.height / dpr}px`;
      const t = page.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c });
      task = t;
      t.promise.catch(() => undefined);
    });
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, n, scale, visible]);
  return (
    <div className="v-pdf__page" ref={holder} data-page={n}>
      <canvas ref={canvas} />
    </div>
  );
}

function PdfView({ att }: { att: Attachment }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.1);
  useEffect(() => {
    let alive = true;
    let loaded: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const data = new Uint8Array(await (await fetch(api.fileUrl(att.id), { credentials: "same-origin" })).arrayBuffer());
        loaded = (await pdfjs.getDocument({ data, enableXfa: false, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/" }).promise) as unknown as PdfDoc;
        if (alive) setDoc(loaded);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      void loaded?.destroy();
    };
  }, [att]);
  if (error) return <p className="muted pad">No se pudo abrir el PDF: {error}</p>;
  if (!doc) return <div className="center pad"><Spinner size={26} /></div>;
  return (
    <div className="v-pdf">
      <div className="v-pdf__pages">
        {Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i} doc={doc} n={i + 1} scale={scale} />
        ))}
      </div>
      <div className="v-toolbar">
        <IconButton icon="zoomOut" label="Alejar" onClick={() => setScale((s) => Math.max(0.5, s / 1.2))} />
        <span className="v-toolbar__value">{Math.round(scale * 100)}%</span>
        <IconButton icon="zoomIn" label="Acercar" onClick={() => setScale((s) => Math.min(4, s * 1.2))} />
        <span className="v-toolbar__sep" />
        <span className="v-toolbar__value">{doc.numPages} pág.</span>
      </div>
    </div>
  );
}

function colName(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function PreviewView({ att }: { att: Attachment }) {
  const [p, setP] = useState<FilePreview | null>(null);
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    let alive = true;
    void api.preview(att.id).then((r) => alive && setP(r)).catch((e: Error) => alive && setP({ kind: "unsupported", reason: e.message }));
    return () => {
      alive = false;
    };
  }, [att]);
  if (!p) return <div className="center pad"><Spinner size={26} /></div>;
  if (p.kind === "html") return <article className="v-doc" dangerouslySetInnerHTML={{ __html: sanitize(p.html, { allowImages: true }) }} />;
  if (p.kind === "text") {
    const lines = p.text.split("\n");
    return (
      <div className="v-text">
        <pre>
          {lines.map((l, i) => (
            <span key={i} className="v-text__line">
              <span className="v-text__n">{i + 1}</span>
              {l || " "}
            </span>
          ))}
        </pre>
        {p.truncated && <p className="muted small pad">Vista recortada; descarga el archivo para verlo completo.</p>}
      </div>
    );
  }
  if (p.kind === "sheet") {
    const s = p.sheets[sheet] ?? p.sheets[0];
    const cols = Math.max(0, ...s.rows.map((r) => r.length));
    return (
      <div className="v-sheet">
        <div className="v-sheet__scroll">
          <table>
            <thead>
              <tr>
                <th className="v-sheet__corner" />
                {Array.from({ length: cols }, (_, i) => (
                  <th key={i}>{colName(i)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  <th>{i + 1}</th>
                  {Array.from({ length: cols }, (_, j) => (
                    <td key={j}>{r[j] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.sheets.length > 1 && (
          <div className="v-sheet__tabs">
            {p.sheets.map((x, i) => (
              <button key={x.name} type="button" className={i === sheet ? "is-on" : ""} onClick={() => setSheet(i)}>
                {x.name}
              </button>
            ))}
          </div>
        )}
        {s.truncated && <p className="muted small pad">Se muestran las primeras 2000 filas.</p>}
      </div>
    );
  }
  return (
    <div className="v-none">
      <Icon name={kindIcon(att.kind)} size={40} />
      <p>{p.reason}</p>
      <a className="btn btn--primary btn--md" href={api.fileUrl(att.id, true)} download>
        <Icon name="download" size={17} />
        <span>Descargar</span>
      </a>
    </div>
  );
}

export function FileViewer({ items, index, onClose, onIndex }: { items: Attachment[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const att = items[index];
  const go = useCallback((d: number) => items.length > 1 && onIndex((index + d + items.length) % items.length), [index, items.length, onIndex]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  return (
    <Overlay open={!!att} onClose={onClose} kind="viewer" label="Visor de archivos">
      {att && (
        <div className="viewer">
          <header className="viewer__head">
            <span className={`att__icon att__icon--${att.kind}`}>
              <Icon name={kindIcon(att.kind)} size={18} />
            </span>
            <div className="viewer__meta">
              <p className="viewer__name">{att.name}</p>
              <p className="viewer__sub">
                {formatBytes(att.size)}
                {items.length > 1 ? ` · ${index + 1} de ${items.length}` : ""}
              </p>
            </div>
            <div className="viewer__actions">
              {items.length > 1 && (
                <>
                  <IconButton icon="chevronLeft" label="Anterior" onClick={() => go(-1)} />
                  <IconButton icon="chevronRight" label="Siguiente" onClick={() => go(1)} />
                </>
              )}
              <a className="icon-btn icon-btn--md" href={api.fileUrl(att.id, true)} download aria-label="Descargar">
                <Icon name="download" size={18} />
              </a>
              <IconButton icon="x" label="Cerrar" onClick={onClose} data-autofocus />
            </div>
          </header>
          <div className="viewer__body" key={att.id}>
            {att.kind === "image" ? <ImageView att={att} /> : att.kind === "pdf" ? <PdfView att={att} /> : <PreviewView att={att} />}
          </div>
        </div>
      )}
    </Overlay>
  );
}
