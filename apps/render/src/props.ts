import { z } from "zod";
import { captionCueSchema, captionStyleSchema } from "@fav/core";

export const sceneMotionSchema = z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right"]);
export type SceneMotion = z.infer<typeof sceneMotionSchema>;

export const renderSceneSchema = z.object({
  /** data:, file-served, or https URL of the still image. */
  imageUrl: z.string(),
  /** max tier: video clip instead of the still (FAV-503). */
  clipUrl: z.string().optional(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  onScreenText: z.string().optional(),
  motion: sceneMotionSchema.optional()
});
export type RenderScene = z.infer<typeof renderSceneSchema>;

export const transitionSchema = z.enum(["none", "fade", "slide", "zoom"]);

/** Everything the composition needs — props fully drive output (FAV-801 AC). */
export const renderPropsSchema = z.object({
  scenes: z.array(renderSceneSchema).min(1),
  audioUrl: z.string(),
  musicUrl: z.string().optional(),
  cues: z.array(captionCueSchema),
  captionStyle: captionStyleSchema.default("bold"),
  transition: transitionSchema.default("fade"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().default(30),
  durationSeconds: z.number().positive(),
  /** AI-provenance watermark badge (FAV-1607). */
  watermark: z.boolean().default(false)
});
export type RenderProps = z.infer<typeof renderPropsSchema>;
