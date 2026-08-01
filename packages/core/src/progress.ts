import { z } from "zod";

/** Ordered pipeline stages; the UI derives percent from stage + stage-local progress (FAV-905). */
export const PIPELINE_STAGES = [
  "reserving_credits",
  "moderating",
  "scripting",
  "generating_visuals",
  "synthesizing_voice",
  "transcribing",
  "building_captions",
  "rendering",
  "storing",
  "finalizing"
] as const;

export const pipelineStageSchema = z.enum(PIPELINE_STAGES);
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const STAGE_LABELS: Record<PipelineStage, string> = {
  reserving_credits: "Reserving credits",
  moderating: "Checking topic",
  scripting: "Writing script",
  generating_visuals: "Creating visuals",
  synthesizing_voice: "Recording voiceover",
  transcribing: "Timing narration",
  building_captions: "Building captions",
  rendering: "Rendering video",
  storing: "Saving video",
  finalizing: "Finishing up"
};

export const jobProgressSchema = z.object({
  stage: pipelineStageSchema,
  /** 0-100 within the current stage (e.g. scenes completed / total). */
  stageProgress: z.number().min(0).max(100).default(0),
  detail: z.string().optional()
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

/** Overall percent across stages, weighting render/visuals heavier since they dominate wall time. */
const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  reserving_credits: 2,
  moderating: 2,
  scripting: 10,
  generating_visuals: 30,
  synthesizing_voice: 10,
  transcribing: 5,
  building_captions: 3,
  rendering: 30,
  storing: 5,
  finalizing: 3
};

export function overallPercent(progress: JobProgress): number {
  const total = PIPELINE_STAGES.reduce((sum, stage) => sum + STAGE_WEIGHTS[stage], 0);
  let done = 0;
  for (const stage of PIPELINE_STAGES) {
    if (stage === progress.stage) {
      done += (STAGE_WEIGHTS[stage] * progress.stageProgress) / 100;
      break;
    }
    done += STAGE_WEIGHTS[stage];
  }
  return Math.min(100, Math.round((done / total) * 100));
}
