import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { MSG } from "../../../../shared/messages";
import type { Attachment } from "../../../../shared/protocol";
import { ACCEPTED_EXT, LIMITS, extOf } from "../../../../shared/schemas";
import { uploadFile } from "../../api";
import { Tooltip } from "../../ui/floating";
import { Icon, kindIcon } from "../../ui/icons";
import { IconButton, Spinner, formatBytes, useToast } from "../../ui/primitives";
import { useVoice } from "./useVoice";

export const ACCEPT = ACCEPTED_EXT.map((e) => `.${e}`).join(",");
const ACCEPTED = new Set<string>(ACCEPTED_EXT);

type Pending = { key: string; file: File; progress: number; status: "uploading" | "done" | "error"; att?: Attachment; error?: string; thumb?: string; ctrl: AbortController };

export type ComposerHandle = { addFiles: (files: File[]) => void; setText: (t: string) => void; focus: () => void };

const join = (a: string, b: string) => (a && b ? `${a.replace(/\s+$/, "")} ${b}` : a || b);

export function Composer({ ref, busy, onSend, onStop, stt, maxUploadMb, onOpen, placeholder }: { ref?: Ref<ComposerHandle>; busy: boolean; onSend: (text: string, atts: Attachment[]) => void; onStop: () => void; stt: "server" | "browser"; maxUploadMb: number; onOpen: (a: Attachment) => void; placeholder: string }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bars = useRef<HTMLSpanElement>(null);
  const base = useRef("");
  const toast = useToast();

  const voice = useVoice(stt, {
    onDictation: useCallback((d: string) => setText(join(base.current, d)), []),
    onTranscript: useCallback((t: string) => setText((cur) => join(cur, t)), []),
    onLevel: useCallback((level: number) => {
      // Directo al DOM: el medidor no re-renderiza el compositor en cada cuadro.
      const el = bars.current;
      if (!el) return;
      const k = [0.55, 1, 0.75, 0.9, 0.6];
      Array.from(el.children).forEach((c, i) => ((c as HTMLElement).style.transform = `scaleY(${0.22 + level * k[i] * 1.7})`));
    }, []),
    onError: useCallback((m: string) => toast("error", m), [toast]),
  });

  // Alto automático del cuadro (hasta 40% de la ventana).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  const addFiles = useCallback(
    (files: File[]) => {
      const max = maxUploadMb * 1024 * 1024;
      let room = LIMITS.attachments - pendingRef.current.filter((p) => p.status !== "error").length;
      const added: Pending[] = [];
      {
        for (const file of files) {
          if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
            toast("error", `${file.name}: ${MSG.fileVideo}`);
            continue;
          }
          if (!ACCEPTED.has(extOf(file.name))) {
            toast("error", `${file.name}: ${MSG.fileType}`);
            continue;
          }
          if (file.size > max) {
            toast("error", `${file.name}: ${MSG.fileTooBig(maxUploadMb)}`);
            continue;
          }
          if (room <= 0) {
            toast("error", MSG.tooManyAttachments);
            break;
          }
          room--;
          const key = crypto.randomUUID();
          const ctrl = new AbortController();
          const thumb = /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(file.type) ? URL.createObjectURL(file) : undefined;
          added.push({ key, file, progress: 0, status: "uploading", thumb, ctrl });
        }
      }
      if (!added.length) return;
      pendingRef.current = [...pendingRef.current, ...added];
      setPending((p) => [...p, ...added]);
      for (const { key, file, ctrl } of added) {
        uploadFile(file, (r) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: r } : x))), ctrl.signal)
          .then((att) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "done", att, progress: 1 } : x))))
          .catch((e: Error) => {
            if (ctrl.signal.aborted) return;
            setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "error", error: e.message } : x)));
            toast("error", `${file.name}: ${e.message}`);
          });
      }
    },
    [maxUploadMb, toast],
  );

  useImperativeHandle(ref, () => ({ addFiles, setText: (t) => setText(t), focus: () => area.current?.focus() }), [addFiles]);

  const removePending = (key: string) =>
    setPending((p) => {
      const x = p.find((i) => i.key === key);
      x?.ctrl.abort();
      if (x?.thumb) URL.revokeObjectURL(x.thumb);
      return p.filter((i) => i.key !== key);
    });

  const uploading = pending.some((p) => p.status === "uploading");
  const ready = pending.filter((p) => p.status === "done" && p.att).map((p) => p.att!);
  const tooLong = text.length > LIMITS.messageChars;
  const canSend = !busy && !uploading && !tooLong && (text.trim().length > 0 || ready.length > 0);
  const nearLimit = text.length > LIMITS.messageChars * 0.9;

  const submit = () => {
    if (tooLong) return toast("error", MSG.messageTooLong);
    if (!canSend) return;
    if (voice.state === "listening") voice.stop();
    onSend(text.trim(), ready);
    setText("");
    base.current = "";
    pending.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
    setPending([]);
  };

  const toggleVoice = () => {
    if (voice.state === "listening") voice.stop();
    else {
      base.current = text.trim();
      void voice.start();
    }
  };

  return (
    <div className={`composer ${voice.state === "listening" ? "is-listening" : ""}`}>
      {pending.length > 0 && (
        <div className="composer__files">
          {pending.map((p) => (
            <div key={p.key} className={`chip chip--${p.status}`}>
              <button type="button" className="chip__body" onClick={() => p.att && onOpen(p.att)} disabled={!p.att} title={p.error ?? p.file.name}>
                {p.thumb ? (
                  <img src={p.thumb} alt="" className="chip__thumb" />
                ) : (
                  <span className="chip__icon">
                    <Icon name={kindIcon(p.att?.kind ?? "file")} size={18} />
                  </span>
                )}
                <span className="chip__meta">
                  <span className="chip__name">{p.file.name}</span>
                  <span className="chip__sub">{p.status === "error" ? p.error : p.status === "uploading" ? `Subiendo ${Math.round(p.progress * 100)}%` : formatBytes(p.file.size)}</span>
                </span>
              </button>
              {p.status === "uploading" && <span className="chip__bar" style={{ transform: `scaleX(${p.progress})` }} />}
              <button type="button" className="chip__remove" aria-label={`Quitar ${p.file.name}`} onClick={() => removePending(p.key)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="composer__row">
        <IconButton icon="paperclip" label="Adjuntar evidencia" onClick={() => fileInput.current?.click()} />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <textarea
          ref={area}
          className="composer__input"
          rows={1}
          value={text}
          placeholder={voice.state === "listening" ? "Te escucho…" : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            // Lo que la persona escribe o borra manda sobre el dictado.
            if (voice.state === "listening") {
              base.current = e.target.value;
              voice.rebase();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          aria-label="Mensaje"
          aria-invalid={tooLong}
        />
        <div className="composer__actions">
          {voice.supported && (
            <Tooltip text={voice.state === "listening" ? "Detener dictado" : voice.state === "processing" ? "Transcribiendo" : "Dictar por voz"}>
              <button type="button" className={`mic mic--${voice.state}`} onClick={toggleVoice} disabled={voice.state === "processing"} aria-label="Dictar por voz" aria-pressed={voice.state === "listening"}>
                {voice.state === "processing" ? (
                  <Spinner size={16} />
                ) : voice.state === "listening" ? (
                  <span className="mic__bars" ref={bars} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <Icon name="mic" size={18} />
                )}
              </button>
            </Tooltip>
          )}
          {busy ? (
            <Tooltip text="Detener respuesta">
              <button type="button" className="send send--stop" onClick={onStop} aria-label="Detener respuesta">
                <Icon name="stop" size={16} />
              </button>
            </Tooltip>
          ) : (
            <button type="button" className="send" onClick={submit} disabled={!canSend} aria-label="Enviar">
              <Icon name="send" size={18} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
      <p className={`composer__hint ${nearLimit ? "is-warn" : ""}`}>
        {nearLimit ? (
          `${text.length.toLocaleString("es-CO")} / ${LIMITS.messageChars.toLocaleString("es-CO")} caracteres`
        ) : (
          <>
            <kbd>Enter</kbd> envía · <kbd>Shift</kbd> + <kbd>Enter</kbd> nueva línea · Toda escritura en Azure, Ripor o Chat pide tu aprobación.
          </>
        )}
      </p>
    </div>
  );
}
