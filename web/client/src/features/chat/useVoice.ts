/**
 * Dictado: voz a texto en el cuadro del mensaje (la persona revisa y envía con Enter).
 * - "browser": reconocimiento del navegador, con resultados parciales en vivo. Arranca de inmediato (el medidor
 *   del micrófono se abre en paralelo y no lo retrasa).
 * - "server": graba y transcribe con el proveedor configurado en el servidor.
 *
 * Regla de edición: lo que la persona escribe o borra manda. `rebase()` marca ese punto y solo se agrega lo que se
 * dicte después; al detener NO se vuelve a insertar nada que ya se mostró.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MSG } from "../../../../shared/messages";
import { transcribe } from "../../api";

type Mode = "server" | "browser";
export type VoiceState = "idle" | "listening" | "processing";

type Result = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<Result> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoice(
  mode: Mode,
  handlers: {
    /** Texto dictado desde el último rebase (final + parcial), para mostrar en vivo. */
    onDictation: (text: string) => void;
    /** Texto final del modo servidor, para agregar al final de lo que haya. */
    onTranscript: (text: string) => void;
    /** Nivel 0..1 en cada cuadro (sin estado de React: no re-renderiza). */
    onLevel: (level: number) => void;
    onError: (message: string) => void;
  },
) {
  const [state, setState] = useState<VoiceState>("idle");
  const h = useRef(handlers);
  h.current = handlers;
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const recog = useRef<Recognition | null>(null);
  const finals = useRef("");
  const fromIndex = useRef(0);
  const lastIndex = useRef(0);
  const seen = useRef(0);
  const live = useRef(false);

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && (mode === "server" ? typeof MediaRecorder !== "undefined" : !!recognitionCtor());

  const releaseMeter = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    h.current.onLevel(0);
  }, []);

  const meter = useCallback((s: MediaStream) => {
    const ac = new AudioContext();
    audioCtx.current = ac;
    const an = ac.createAnalyser();
    an.fftSize = 256;
    ac.createMediaStreamSource(s).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let level = 0;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      level = level * 0.55 + Math.min(1, Math.sqrt(sum / buf.length) * 4.5) * 0.45;
      h.current.onLevel(level);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  useEffect(
    () => () => {
      live.current = false;
      recog.current?.abort();
      if (recorder.current?.state === "recording") recorder.current.stop();
      releaseMeter();
    },
    [releaseMeter],
  );

  const failMic = useCallback(
    (e: unknown) => {
      live.current = false;
      releaseMeter();
      setState("idle");
      h.current.onError((e as DOMException)?.name === "NotAllowedError" ? MSG.micDenied : MSG.micUnavailable);
    },
    [releaseMeter],
  );

  const start = useCallback(async () => {
    if (state !== "idle") return;
    finals.current = "";
    fromIndex.current = 0;
    lastIndex.current = 0;
    seen.current = 0;
    live.current = true;

    if (mode === "browser") {
      const R = recognitionCtor()!;
      const r = new R();
      r.lang = "es-CO";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (e) => {
        if (!live.current) return;
        seen.current = e.results.length;
        let interim = "";
        for (let i = Math.max(e.resultIndex, fromIndex.current); i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            if (i >= lastIndex.current) {
              finals.current += res[0].transcript;
              lastIndex.current = i + 1;
            }
          } else interim += res[0].transcript;
        }
        h.current.onDictation((finals.current + interim).replace(/\s+/g, " ").trim());
      };
      r.onerror = (e) => {
        if (e.error === "aborted" || e.error === "no-speech") return;
        h.current.onError(e.error === "not-allowed" || e.error === "service-not-allowed" ? MSG.micDenied : MSG.sttUnavailable);
      };
      r.onend = () => {
        live.current = false;
        releaseMeter();
        setState("idle");
      };
      recog.current = r;
      try {
        r.start(); // primero el reconocimiento: así no se pierde el inicio de la frase
      } catch (e) {
        failMic(e);
        return;
      }
      setState("listening");
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then((s) => {
          if (!live.current) return s.getTracks().forEach((t) => t.stop());
          stream.current = s;
          meter(s);
        })
        .catch(() => undefined); // sin medidor no pasa nada; el reconocimiento ya está corriendo
      return;
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      meter(s);
      const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        releaseMeter();
        if (!live.current) return setState("idle");
        live.current = false;
        setState("processing");
        try {
          const text = await transcribe(new Blob(chunks, { type: rec.mimeType }));
          if (text) h.current.onTranscript(text);
        } catch (e) {
          h.current.onError((e as Error).message);
        } finally {
          setState("idle");
        }
      };
      recorder.current = rec;
      rec.start(250);
      setState("listening");
    } catch (e) {
      failMic(e);
    }
  }, [failMic, meter, mode, releaseMeter, state]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    if (recog.current) {
      live.current = false; // lo que llegue después de detener ya no se inserta
      recog.current.stop();
    }
  }, []);

  /** La persona editó el texto: desde aquí solo cuenta lo que se dicte después. */
  const rebase = useCallback(() => {
    finals.current = "";
    // También se descarta la frase en curso: la persona ya decidió qué texto queda.
    fromIndex.current = lastIndex.current = Math.max(seen.current, lastIndex.current, fromIndex.current);
  }, []);

  return { state, supported, start, stop, rebase };
}
