import type { Db } from "@fav/db";
import {
  getFallbackVisualsProvider,
  getLlmProvider,
  getModerationProvider,
  getStorageProvider,
  getTranscriptionProvider,
  getTtsProvider,
  getVisualsProvider,
  type LlmProvider,
  type ModerationProvider,
  type StorageProvider,
  type TranscriptionProvider,
  type TtsProvider,
  type VisualsProvider
} from "@fav/providers";
import type { RenderProps } from "@fav/render";

export type RenderFn = (args: {
  props: RenderProps;
  outPath: string;
  onProgress?: (percent: number) => void;
  timeoutMs?: number;
}) => Promise<{ outPath: string; sizeBytes: number }>;

/** Everything the pipeline touches, injectable for tests (fake renderer, test db). */
export interface PipelineDeps {
  db: Db;
  llm: LlmProvider;
  visuals: VisualsProvider;
  fallbackVisuals: VisualsProvider;
  tts: TtsProvider;
  transcription: TranscriptionProvider;
  moderation: ModerationProvider;
  storage: StorageProvider;
  render: RenderFn;
}

/** Production wiring: env-selected providers + the real Remotion renderer. */
export function defaultDeps(db: Db): PipelineDeps {
  return {
    db,
    llm: getLlmProvider(),
    visuals: getVisualsProvider(),
    fallbackVisuals: getFallbackVisualsProvider(),
    tts: getTtsProvider(),
    transcription: getTranscriptionProvider(),
    moderation: getModerationProvider(),
    storage: getStorageProvider(),
    render: async (args) => {
      // Lazy so the heavy Remotion stack loads only when a render actually runs.
      const { renderVideo } = await import("@fav/render");
      return renderVideo(args);
    }
  };
}
