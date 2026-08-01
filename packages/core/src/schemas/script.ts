import { z } from "zod";
import { toneSchema, visualStyleSchema } from "./video.js";

/** One scene of the generated script (FAV-402): narration + visual prompt + on-screen text. */
export const sceneScriptSchema = z.object({
  index: z.number().int().min(0),
  narration: z.string().min(1).max(1200),
  visualPrompt: z.string().min(1).max(1000),
  onScreenText: z.string().max(120).optional()
});
export type SceneScript = z.infer<typeof sceneScriptSchema>;

/** The full LLM output, validated before anything downstream trusts it (FAV-402 AC). */
export const videoScriptSchema = z.object({
  title: z.string().min(1).max(150),
  hook: z.string().max(300).optional(),
  scenes: z.array(sceneScriptSchema).min(1).max(40)
});
export type VideoScript = z.infer<typeof videoScriptSchema>;

export const scriptGenerationInputSchema = z.object({
  topic: z.string().min(3),
  targetDurationSeconds: z.number().int().positive(),
  tone: toneSchema,
  visualStyle: visualStyleSchema,
  language: z.string().default("en")
});
export type ScriptGenerationInput = z.infer<typeof scriptGenerationInputSchema>;
