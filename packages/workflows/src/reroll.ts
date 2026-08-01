import { and, eq } from "drizzle-orm";
import { newId, rerollCost, videoRequestSchema } from "@fav/core";
import { finalizeCredits, jobs, refundCredits, reserveCredits, scenes, videos } from "@fav/db";
import { assetKeys, withFallback } from "@fav/providers";
import type { PipelineDeps } from "./deps.js";

/** Enqueue a single-scene visual re-roll (FAV-505). */
export async function createRerollJob(
  db: PipelineDeps["db"],
  args: { orgId: string; videoId: string; sceneIndex: number; userId?: string }
): Promise<{ jobId: string }> {
  const jobId = newId("job");
  await db.insert(jobs).values({
    id: jobId,
    orgId: args.orgId,
    videoId: args.videoId,
    kind: "reroll",
    status: "queued",
    // One in-flight re-roll per scene; a finished one frees the key via its counter.
    idempotencyKey: `reroll:${args.videoId}:${args.sceneIndex}:${Date.now()}`,
    detail: JSON.stringify({ sceneIndex: args.sceneIndex }),
    traceId: newId("trc")
  });
  return { jobId };
}

/**
 * Re-roll one scene's visual without touching the rest (FAV-505): incremental
 * credit charge, regenerated asset overwrites the same storage key, and the
 * stale final render is invalidated so the next render picks up the new art.
 */
export async function runRerollJob(deps: PipelineDeps, jobId: string): Promise<void> {
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || !job.videoId) throw new Error(`Reroll job ${jobId} not found`);
  if (job.status === "completed") return;
  const { sceneIndex } = JSON.parse(job.detail ?? "{}") as { sceneIndex: number };

  const [video] = await deps.db.select().from(videos).where(eq(videos.id, job.videoId));
  if (!video) throw new Error(`Video ${job.videoId} not found`);
  const request = videoRequestSchema.parse(video.request);
  const [scene] = await deps.db
    .select()
    .from(scenes)
    .where(and(eq(scenes.videoId, job.videoId), eq(scenes.index, sceneIndex)));
  if (!scene) throw new Error(`Scene ${sceneIndex} not found for ${job.videoId}`);

  // Attempt counting belongs to the queue (see runGenerationJob).
  await deps.db
    .update(jobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(jobs.id, jobId));

  try {
    const cost = rerollCost(request.tier);
    await reserveCredits(deps.db, {
      orgId: job.orgId,
      jobId,
      videoId: job.videoId,
      amount: cost,
      reason: `Scene ${sceneIndex + 1} re-roll`
    });

    await deps.db.update(scenes).set({ status: "generating" }).where(eq(scenes.id, scene.id));
    const image = await withFallback(
      {
        name: `visuals:${deps.visuals.name}`,
        fn: () =>
          deps.visuals.generateImage({
            prompt: scene.visualPrompt,
            style: request.visualStyle,
            tier: request.tier,
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            // New seed per re-roll so the creator actually gets a different image.
            seed: scene.index + (scene.rerollCount + 1) * 1000
          })
      },
      deps.visuals.name === deps.fallbackVisuals.name
        ? undefined
        : {
            name: `visuals:${deps.fallbackVisuals.name}`,
            fn: () =>
              deps.fallbackVisuals.generateImage({
                prompt: scene.visualPrompt,
                style: request.visualStyle,
                tier: request.tier,
                aspectRatio: request.aspectRatio,
                resolution: request.resolution,
                seed: scene.index + (scene.rerollCount + 1) * 1000
              })
          }
    );

    const key = assetKeys.sceneImage(job.videoId, scene.index, image.extension);
    await deps.storage.put(key, image.data, image.contentType); // overwrite, never duplicate
    await deps.db
      .update(scenes)
      .set({
        imageAssetKey: key,
        status: "completed",
        rerollCount: scene.rerollCount + 1,
        updatedAt: new Date()
      })
      .where(eq(scenes.id, scene.id));

    // The rendered MP4 no longer matches its scenes — invalidate it.
    if (video.finalAssetKey) {
      await deps.storage.delete(video.finalAssetKey);
      await deps.db
        .update(videos)
        .set({ finalAssetKey: null, status: "draft", updatedAt: new Date() })
        .where(eq(videos.id, job.videoId));
    }

    await finalizeCredits(deps.db, { orgId: job.orgId, jobId, videoId: job.videoId, actualCost: cost });
    await deps.db
      .update(jobs)
      .set({ status: "completed", stageProgress: 100, finishedAt: new Date() })
      .where(eq(jobs.id, jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await refundCredits(deps.db, { orgId: job.orgId, jobId, videoId: job.videoId, reason: message.slice(0, 200) });
    await deps.db.update(scenes).set({ status: "completed" }).where(eq(scenes.id, scene.id));
    await deps.db
      .update(jobs)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(jobs.id, jobId));
    throw err;
  }
}
