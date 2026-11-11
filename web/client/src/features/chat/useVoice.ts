/**
 * Dictado: voz a texto en el cuadro del mensaje (la persona revisa y envía con Enter).
 * - "server": graba y transcribe con el proveedor configurado en el servidor.
 * - "browser": reconocimiento del navegador (sin configuración), con resultados parciales en vivo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { transcribe } from "../../api";

type Mode = "server" | "browser";
export type VoiceState = "idle" | "listening" | "processing";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoice(mode: Mode, onText: (text: string, final: boolean) => void, onError: (m: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const recog = useRef<Recognition | null>(null);
  const finalText = useRef("");

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && (mode === "server" ? typeof MediaRecorder !== "undefined" : !!recognitionCtor());

  const release = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    setLevel(0);
  }, []);

  useEffect(() => () => {
    recog.current?.abort();
    recorder.current?.state === "recording" && recorder.current.stop();
    release();
  }, [release]);

  const meter = useCallback((s: MediaStream) => {
    const ac = new AudioContext();
    ctx.current = ac;
    const an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(s).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      setLevel((l) => l * 0.6 + Math.min(1, Math.sqrt(sum / buf.length) * 4) * 0.4);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      meter(s);
      finalText.current = "";
      if (mode === "server") {
        const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
        const rec = new MediaRecorder(s, type ? { mimeType: type } : undefined);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = async () => {
          release();
          setState("processing");
          try {
            const text = await transcribe(new Blob(chunks, { type: rec.mimeType }));
            if (text) onText(text, true);
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setState("idle");
          }
        };
        recorder.current = rec;
        rec.start();
      } else {
        const R = recognitionCtor()!;
        const r = new R();
        r.lang = "es-CO";
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) finalText.current += res[0].transcript;
            else interim += res[0].transcript;
          }
          onText((finalText.current + interim).trim(), false);
        };
        r.onerror = (e) => {
          if (e.error !== "aborted" && e.error !== "no-speech") onError(e.error === "not-allowed" ? "Permite el micrófono para dictar." : "El dictado del navegador no está disponible ahora.");
        };
        r.onend = () => {
          release();
          setState("idle");
          if (finalText.current.trim()) onText(finalText.current.trim(), true);
        };
        recog.current = r;
        r.start();
      }
      setState("listening");
    } catch {
      release();
      setState("idle");
      onError("No se pudo usar el micrófono. Revisa el permiso del navegador.");
    }
  }, [meter, mode, onError, onText, release, state]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    recog.current?.stop();
  }, []);

  return { state, level, supported, start, stop };
}
