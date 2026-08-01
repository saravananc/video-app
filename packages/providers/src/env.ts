import path from "node:path";
import type {
  LlmProvider,
  ModerationProvider,
  StorageProvider,
  TranscriptionProvider,
  TtsProvider,
  VisualsProvider
} from "./types.js";
import { MockLlmProvider } from "./llm/mock.js";
import { AnthropicLlmProvider } from "./llm/anthropic.js";
import { MockVisualsProvider } from "./visuals/mock.js";
import { FalVisualsProvider } from "./visuals/fal.js";
import { MockTtsProvider } from "./tts/mock.js";
import { ElevenLabsTtsProvider } from "./tts/elevenlabs.js";
import { MockTranscriptionProvider } from "./transcription/mock.js";
import { WhisperTranscriptionProvider } from "./transcription/whisper.js";
import { MockModerationProvider } from "./moderation/mock.js";
import { FsStorageProvider } from "./storage/fs.js";
import { R2StorageProvider } from "./storage/r2.js";

/**
 * Provider selection is purely environment-driven (plan decision): an explicit
 * FAV_*_PROVIDER wins; otherwise presence of the relevant API key activates the
 * real adapter; otherwise the deterministic mock. Missing keys never crash dev.
 */

export function getLlmProvider(): LlmProvider {
  const choice = process.env.FAV_LLM_PROVIDER;
  if (choice === "anthropic" || (!choice && process.env.ANTHROPIC_API_KEY)) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("FAV_LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    return new AnthropicLlmProvider(key);
  }
  return new MockLlmProvider();
}

export function getVisualsProvider(): VisualsProvider {
  const choice = process.env.FAV_VISUALS_PROVIDER;
  if (choice === "fal" || (!choice && process.env.FAL_KEY)) {
    const key = process.env.FAL_KEY;
    if (!key) throw new Error("FAV_VISUALS_PROVIDER=fal requires FAL_KEY");
    return new FalVisualsProvider(key);
  }
  return new MockVisualsProvider();
}

/** Fallback visuals provider for the gateway (FAV-501): mock always works. */
export function getFallbackVisualsProvider(): VisualsProvider {
  return new MockVisualsProvider();
}

export function getTtsProvider(): TtsProvider {
  const choice = process.env.FAV_TTS_PROVIDER;
  if (choice === "elevenlabs" || (!choice && process.env.ELEVENLABS_API_KEY)) {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("FAV_TTS_PROVIDER=elevenlabs requires ELEVENLABS_API_KEY");
    return new ElevenLabsTtsProvider(key);
  }
  return new MockTtsProvider();
}

export function getTranscriptionProvider(): TranscriptionProvider {
  const choice = process.env.FAV_TRANSCRIPTION_PROVIDER;
  if (choice === "openai-whisper" || (!choice && process.env.OPENAI_API_KEY)) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("FAV_TRANSCRIPTION_PROVIDER=openai-whisper requires OPENAI_API_KEY");
    return new WhisperTranscriptionProvider(key);
  }
  return new MockTranscriptionProvider();
}

export function getModerationProvider(): ModerationProvider {
  return new MockModerationProvider();
}

let storageSingleton: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (storageSingleton) return storageSingleton;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
    storageSingleton = new R2StorageProvider(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET);
  } else {
    const dataDir = process.env.FAV_DATA_DIR ?? path.join(process.cwd(), ".data");
    storageSingleton = new FsStorageProvider(
      path.join(dataDir, "storage"),
      process.env.FAV_STORAGE_SIGNING_SECRET ?? "dev-signing-secret",
      process.env.FAV_BASE_URL ?? "http://localhost:3000"
    );
  }
  return storageSingleton;
}

/** Test hook. */
export function resetStorageProvider(): void {
  storageSingleton = null;
}
