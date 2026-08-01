/** Feature flag keys (FAV-1703). Keep in sync with the seeded rows in @fav/db. */

export const FLAG_KEYS = {
  /** Max-tier text-to-video clips (FAV-503). */
  textToVideo: "text_to_video",
  /** Voice cloning (FAV-603). */
  voiceCloning: "voice_cloning",
  /** Autopilot scheduling (FAV-14xx). */
  autopilot: "autopilot",
  /** Public REST API + API keys (FAV-15xx). */
  publicApi: "public_api"
} as const;

export type FlagKey = (typeof FLAG_KEYS)[keyof typeof FLAG_KEYS];

export const ALL_FLAG_KEYS: FlagKey[] = Object.values(FLAG_KEYS);

/** User-facing copy when a gated feature is off for an org. */
export const FLAG_DENIED_MESSAGE: Record<FlagKey, string> = {
  text_to_video: "The max quality tier isn't enabled for your organization yet.",
  voice_cloning: "Voice cloning isn't enabled for your organization yet.",
  autopilot: "Autopilot isn't enabled for your organization yet.",
  public_api: "The public API isn't enabled for your organization yet."
};
