import type {
  ScriptGenerationInput,
  VideoScript,
  WordTimestamp,
  AspectRatio,
  Resolution,
  VisualStyle,
  QualityTier
} from "@fav/core";

// ---------------------------------------------------------------------------
// Every external service the pipeline touches sits behind one of these
// interfaces. Each has a real SDK/HTTP adapter (activated by env keys) and a
// deterministic mock, selected in env.ts — the pipeline never knows which.
// ---------------------------------------------------------------------------

/** Script generation via LLM (FAV-401/402). */
export interface LlmProvider {
  readonly name: string;
  generateScript(input: ScriptGenerationInput): Promise<VideoScript>;
  /** Free-form idea generation for autopilot (FAV-1403). */
  generateIdea(niche: string, avoid: string[]): Promise<string>;
}

export interface ImageResult {
  data: Buffer;
  contentType: string;
  /** File extension without dot, e.g. "png", "svg". */
  extension: string;
  costCredits: number;
}

export interface ClipResult {
  data: Buffer;
  contentType: string;
  extension: string;
  durationSeconds: number;
  costCredits: number;
}

/** Per-scene visual generation (FAV-501/502/503). */
export interface VisualsProvider {
  readonly name: string;
  generateImage(args: {
    prompt: string;
    style: VisualStyle;
    tier: QualityTier;
    aspectRatio: AspectRatio;
    resolution: Resolution;
    seed?: number;
  }): Promise<ImageResult>;
  /** max tier only; return null to signal graceful downgrade to stills (FAV-503 AC). */
  generateClip(args: {
    prompt: string;
    style: VisualStyle;
    aspectRatio: AspectRatio;
    durationSeconds: number;
    seed?: number;
  }): Promise<ClipResult | null>;
}

export interface TtsResult {
  audio: Buffer;
  contentType: string;
  extension: string;
  durationSeconds: number;
  costCredits: number;
}

/** Narration synthesis (FAV-601/604). */
export interface TtsProvider {
  readonly name: string;
  synthesize(args: { text: string; voiceId: string; language: string }): Promise<TtsResult>;
  listVoices(): Promise<Array<{ id: string; name: string; language: string; previewText: string }>>;
  /** Voice cloning (FAV-603); mock returns a deterministic clone id. */
  cloneVoice(args: { name: string; sample: Buffer }): Promise<{ providerVoiceId: string }>;
}

/** Word-level transcription of the final audio (FAV-701 — never trust script timing). */
export interface TranscriptionProvider {
  readonly name: string;
  transcribe(args: {
    audio: Buffer;
    /** Hint text (the narration script) — mocks use it; real Whisper ignores it. */
    hintText?: string;
    durationSeconds?: number;
  }): Promise<WordTimestamp[]>;
}

export interface ModerationResult {
  verdict: "allowed" | "blocked" | "flagged";
  categories: string[];
}

/** Input/output moderation (FAV-405/1605). */
export interface ModerationProvider {
  readonly name: string;
  moderate(text: string): Promise<ModerationResult>;
}

/** Object storage (FAV-105/1001): R2 in prod, filesystem in dev. */
export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Short-lived signed URL for reads (FAV-1001 AC). */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Absolute filesystem path when available (dev renderer reads directly); null on remote stores. */
  localPath(key: string): string | null;
}

/** Storage keying convention (FAV-1001 AC: enforced, not ad-hoc). */
export const assetKeys = {
  sceneImage: (videoId: string, sceneIndex: number, ext: string) =>
    `videos/${videoId}/scenes/${sceneIndex}/image.${ext}`,
  sceneClip: (videoId: string, sceneIndex: number, ext: string) =>
    `videos/${videoId}/scenes/${sceneIndex}/clip.${ext}`,
  narration: (videoId: string, ext: string) => `videos/${videoId}/narration.${ext}`,
  finalVideo: (videoId: string) => `videos/${videoId}/final.mp4`,
  thumbnail: (videoId: string) => `videos/${videoId}/thumbnail.png`,
  voicePreview: (voiceId: string) => `voices/${voiceId}/preview.wav`,
  voiceCloneSample: (voiceId: string) => `voices/${voiceId}/sample.wav`
} as const;
