import type { QualityTier, Resolution, VideoRequest } from "./schemas/video.js";
import { sceneCountForDuration } from "./constants.js";

/**
 * Central cost table mapping generation actions to credits (FAV-1207).
 * Values are credits, chosen to keep margin over provider cost; adjust per environment
 * via COST_TABLE_OVERRIDES_JSON if needed.
 */
export const COST_TABLE = {
  scriptGeneration: 1,
  imagePerScene: { basic: 1, premium: 3, max: 3 } satisfies Record<QualityTier, number>,
  /** max tier only: per second of generated video clip (FAV-503 per-second metering). */
  videoClipPerSecond: 4,
  ttsPerThousandChars: 2,
  transcription: 1,
  renderBase: { "1080p": 5, "4k": 15 } satisfies Record<Resolution, number>,
  sceneReroll: { basic: 1, premium: 3, max: 3 } satisfies Record<QualityTier, number>,
  voiceClone: 25
} as const;

/** Starter credits granted on signup with no card (FAV-1208). */
export const STARTER_CREDITS = 50;

export interface CostBreakdown {
  script: number;
  visuals: number;
  voice: number;
  captions: number;
  render: number;
  total: number;
}

/**
 * Pre-flight cost estimate shown in the wizard and reserved before generation
 * (FAV-1102, FAV-904). Uses the same table as actual charging so the two never drift.
 */
export function estimateVideoCost(request: VideoRequest): CostBreakdown {
  const scenes = sceneCountForDuration(request.durationSeconds);
  const script = COST_TABLE.scriptGeneration;

  let visuals: number;
  if (request.tier === "max") {
    const clipSeconds = request.durationSeconds;
    visuals = clipSeconds * COST_TABLE.videoClipPerSecond;
  } else {
    visuals = scenes * COST_TABLE.imagePerScene[request.tier];
  }

  // ~150wpm and ~6 chars/word gives a stable narration-length approximation.
  const approxChars = Math.round((request.durationSeconds / 60) * 150 * 6);
  const voice = Math.max(1, Math.ceil(approxChars / 1000) * COST_TABLE.ttsPerThousandChars);
  const captions = COST_TABLE.transcription;
  const render = COST_TABLE.renderBase[request.resolution];

  return { script, visuals, voice, captions, render, total: script + visuals + voice + captions + render };
}

export function rerollCost(tier: QualityTier): number {
  return COST_TABLE.sceneReroll[tier];
}
