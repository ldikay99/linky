/**
 * Proveedores de IA intercambiables por entorno (LINKY_AI_PROVIDER + LINKY_AI_MODEL).
 * Cada SDK lee su clave de su variable estándar; aquí solo se elige y se valida que exista.
 *
 *   openai     OPENAI_API_KEY
 *   anthropic  ANTHROPIC_API_KEY                         (Claude)
 *   google     GOOGLE_GENERATIVE_AI_API_KEY              (Gemini por AI Studio)
 *   vertex     GOOGLE_VERTEX_PROJECT + GOOGLE_VERTEX_LOCATION + credenciales de GCP (ADC)
 *   mistral    MISTRAL_API_KEY
 *   deepseek   DEEPSEEK_API_KEY
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel, TranscriptionModel } from "ai";
import type { AiStatus } from "../../shared/protocol.js";
import type { Config, ProviderId } from "../config.js";

const DEFAULT_MODEL: Record<Exclude<ProviderId, "none">, string> = {
  openai: "gpt-5",
  anthropic: "claude-sonnet-5-5",
  google: "gemini-2.5-pro",
  vertex: "gemini-2.5-pro",
  mistral: "mistral-large-latest",
  deepseek: "deepseek-chat",
};

const REQUIRED_ENV: Record<Exclude<ProviderId, "none">, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  vertex: ["GOOGLE_VERTEX_PROJECT"],
  mistral: ["MISTRAL_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
};

export type Ai = { status: AiStatus; model: LanguageModel | null; transcriber: TranscriptionModel | null; problem: string | null };

export function createAi(config: Config, env: NodeJS.ProcessEnv = process.env): Ai {
  const transcriber = config.stt.provider === "openai" && env.OPENAI_API_KEY ? createOpenAI().transcription(config.stt.model ?? "gpt-4o-mini-transcribe") : null;
  const provider = config.ai.provider;
  if (provider === "none") return { status: { configured: false, provider: null, model: null }, model: null, transcriber, problem: null };
  const missing = REQUIRED_ENV[provider].filter((k) => !env[k]?.trim());
  const modelId = config.ai.model ?? DEFAULT_MODEL[provider];
  if (missing.length) {
    return {
      status: { configured: false, provider, model: modelId },
      model: null,
      transcriber,
      problem: `Falta ${missing.join(", ")} para el proveedor ${provider}.`,
    };
  }
  const model: LanguageModel = (() => {
    switch (provider) {
      case "openai":
        return createOpenAI()(modelId);
      case "anthropic":
        return createAnthropic()(modelId);
      case "google":
        return createGoogleGenerativeAI()(modelId);
      case "vertex":
        return createVertex({ project: env.GOOGLE_VERTEX_PROJECT, location: env.GOOGLE_VERTEX_LOCATION ?? "us-central1" })(modelId);
      case "mistral":
        return createMistral()(modelId);
      case "deepseek":
        return createDeepSeek()(modelId);
    }
  })();
  return { status: { configured: true, provider, model: modelId }, model, transcriber, problem: null };
}

/** Qué formatos de adjunto lee cada proveedor de forma nativa (el resto va como texto extraído). */
export function nativeFile(provider: string | null, mediaType: string): boolean {
  const images = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (images.includes(mediaType)) return provider !== "deepseek";
  if (mediaType === "application/pdf") return provider === "anthropic" || provider === "google" || provider === "vertex" || provider === "openai";
  return false;
}
