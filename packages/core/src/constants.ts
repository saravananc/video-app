/** Narration pacing model used to map duration <-> word count (FAV-403 AC). */
export const WORDS_PER_MINUTE = 150;

/** Average seconds of narration each scene covers; drives scene count for a target duration. */
export const SECONDS_PER_SCENE = 8;

export const MIN_SCENES = 3;
export const MAX_SCENES = 30;

/** Concurrency cap for parallel scene asset generation (FAV-504). */
export const SCENE_GENERATION_CONCURRENCY = 4;

/** Hard timeout for a single render, in milliseconds (FAV-808). */
export const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

export const FPS = 30;

export function wordsForDuration(seconds: number): number {
  return Math.round((seconds / 60) * WORDS_PER_MINUTE);
}

export function sceneCountForDuration(seconds: number): number {
  return Math.min(MAX_SCENES, Math.max(MIN_SCENES, Math.round(seconds / SECONDS_PER_SCENE)));
}
