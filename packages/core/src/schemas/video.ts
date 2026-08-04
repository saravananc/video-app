import { z } from "zod";

export const aspectRatioSchema = z.enum(["9:16", "16:9"]);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const resolutionSchema = z.enum(["1080p", "4k"]);
export type Resolution = z.infer<typeof resolutionSchema>;

/** Quality tier: basic = standard images, premium = premium images, max = text-to-video clips (FAV-503). */
export const qualityTierSchema = z.enum(["basic", "premium", "max"]);
export type QualityTier = z.infer<typeof qualityTierSchema>;

export const visualStyleSchema = z.enum([
  "cinematic",
  "anime",
  "3d",
  "watercolor",
  "photorealistic",
  "minimalist"
]);
export type VisualStyle = z.infer<typeof visualStyleSchema>;

export const captionStyleSchema = z.enum(["bold", "karaoke", "impact", "clean", "none"]);
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const transitionStyleSchema = z.enum(["none", "fade", "slide", "zoom"]);
export type TransitionStyle = z.infer<typeof transitionStyleSchema>;

export const toneSchema = z.enum([
  "informative",
  "dramatic",
  "casual",
  "inspirational",
  "humorous",
  "mysterious"
]);
export type Tone = z.infer<typeof toneSchema>;

export const VIDEO_STATUSES = [
  "draft",
  "queued",
  "generating",
  "rendering",
  "completed",
  "failed",
  "canceled"
] as const;

export const videoStatusSchema = z.enum(VIDEO_STATUSES);
export type VideoStatus = z.infer<typeof videoStatusSchema>;

/** Everything the creator chooses in the wizard (FAV-1102). */
export const videoRequestSchema = z.object({
  topic: z.string().min(3).max(500),
  durationSeconds: z.number().int().min(15).max(600).default(60),
  aspectRatio: aspectRatioSchema.default("9:16"),
  resolution: resolutionSchema.default("1080p"),
  tier: qualityTierSchema.default("basic"),
  visualStyle: visualStyleSchema.default("cinematic"),
  captionStyle: captionStyleSchema.default("bold"),
  transition: transitionStyleSchema.default("fade"),
  tone: toneSchema.default("informative"),
  voiceId: z.string().optional(),
  language: z.string().default("en"),
  musicTrackId: z.string().optional(),
  /** Optional AI-provenance watermark burned into the corner (FAV-1607). */
  watermark: z.boolean().default(false)
});
export type VideoRequest = z.infer<typeof videoRequestSchema>;

export function dimensionsFor(aspect: AspectRatio, resolution: Resolution) {
  const long = resolution === "4k" ? 3840 : 1920;
  const short = resolution === "4k" ? 2160 : 1080;
  return aspect === "9:16" ? { width: short, height: long } : { width: long, height: short };
}
