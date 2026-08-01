import { and, eq, isNotNull, lt } from "drizzle-orm";
import { videoScriptSchema } from "@fav/core";
import { scenes, videos, type Db } from "@fav/db";
import type { StorageProvider } from "@fav/providers";
import { assetKeys } from "@fav/providers";

/**
 * Apply a scene edit (FAV-404/1103) and invalidate exactly the downstream
 * artifacts the change touches — the next generation run regenerates only those.
 */
export async function applySceneEdit(
  db: Db,
  args: {
    videoId: string;
    sceneIndex: number;
    narration?: string;
    visualPrompt?: string;
    onScreenText?: string | null;
  }
): Promise<void> {
  const [video] = await db.select().from(videos).where(eq(videos.id, args.videoId));
  if (!video) throw new Error(`Video ${args.videoId} not found`);
  const [scene] = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.videoId, args.videoId), eq(scenes.index, args.sceneIndex)));
  if (!scene) throw new Error(`Scene ${args.sceneIndex} not found`);

  const sceneChanges: Partial<typeof scenes.$inferInsert> = { updatedAt: new Date() };
  const videoChanges: Partial<typeof videos.$inferInsert> = { updatedAt: new Date() };
  let invalidateFinal = false;

  if (args.narration !== undefined && args.narration !== scene.narration) {
    sceneChanges.narration = args.narration;
    // Narration changed -> voiceover, timings, and captions are stale.
    videoChanges.narrationAssetKey = null;
    videoChanges.captionCues = null;
    videoChanges.durationSeconds = null;
    invalidateFinal = true;
  }
  if (args.visualPrompt !== undefined && args.visualPrompt !== scene.visualPrompt) {
    sceneChanges.visualPrompt = args.visualPrompt;
    // Prompt changed -> this scene's visual is stale.
    sceneChanges.imageAssetKey = null;
    sceneChanges.clipAssetKey = null;
    sceneChanges.status = "pending";
    invalidateFinal = true;
  }
  if (args.onScreenText !== undefined) {
    sceneChanges.onScreenText = args.onScreenText;
    invalidateFinal = true;
  }

  if (invalidateFinal) {
    videoChanges.finalAssetKey = null;
    videoChanges.playbackId = null;
    videoChanges.status = "draft";
  }

  // Edits persist to the script as well so regeneration keeps them (FAV-404 AC).
  if (video.script) {
    const script = videoScriptSchema.parse(video.script);
    const target = script.scenes.find((s) => s.index === args.sceneIndex);
    if (target) {
      if (sceneChanges.narration) target.narration = sceneChanges.narration;
      if (sceneChanges.visualPrompt) target.visualPrompt = sceneChanges.visualPrompt;
      if (args.onScreenText !== undefined) target.onScreenText = args.onScreenText ?? undefined;
      videoChanges.script = script;
    }
  }

  await db.update(scenes).set(sceneChanges).where(eq(scenes.id, scene.id));
  await db.update(videos).set(videoChanges).where(eq(videos.id, args.videoId));
}

/** Full script regeneration (FAV-404): drop the script + scenes and all derived assets. */
export async function resetScriptForRegeneration(db: Db, storage: StorageProvider, videoId: string): Promise<void> {
  const sceneRows = await db.select().from(scenes).where(eq(scenes.videoId, videoId));
  for (const scene of sceneRows) {
    if (scene.imageAssetKey) await storage.delete(scene.imageAssetKey);
    if (scene.clipAssetKey) await storage.delete(scene.clipAssetKey);
  }
  await db.delete(scenes).where(eq(scenes.videoId, videoId));
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (video?.narrationAssetKey) await storage.delete(video.narrationAssetKey);
  if (video?.finalAssetKey) await storage.delete(video.finalAssetKey);
  await db
    .update(videos)
    .set({
      script: null,
      narrationAssetKey: null,
      captionCues: null,
      durationSeconds: null,
      finalAssetKey: null,
      playbackId: null,
      status: "draft",
      updatedAt: new Date()
    })
    .where(eq(videos.id, videoId));
}

/**
 * Expire intermediate assets for completed videos older than the retention
 * window (FAV-1003): narration audio goes (regenerable), scene images stay —
 * they're re-roll inputs. Final renders are never touched here.
 */
export async function cleanupIntermediateAssets(
  db: Db,
  storage: StorageProvider,
  olderThanDays = 7
): Promise<{ cleaned: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000);
  const rows = await db
    .select({ id: videos.id, narrationAssetKey: videos.narrationAssetKey })
    .from(videos)
    .where(and(eq(videos.status, "completed"), isNotNull(videos.narrationAssetKey), lt(videos.completedAt, cutoff)));
  let cleaned = 0;
  for (const row of rows) {
    if (row.narrationAssetKey) {
      await storage.delete(row.narrationAssetKey);
      await db.update(videos).set({ narrationAssetKey: null }).where(eq(videos.id, row.id));
      cleaned++;
    }
  }
  return { cleaned };
}

/** Purge every stored asset for a video (deletion cascade, FAV-1606). */
export async function purgeVideoAssets(db: Db, storage: StorageProvider, videoId: string): Promise<void> {
  const sceneRows = await db.select().from(scenes).where(eq(scenes.videoId, videoId));
  for (const scene of sceneRows) {
    if (scene.imageAssetKey) await storage.delete(scene.imageAssetKey);
    if (scene.clipAssetKey) await storage.delete(scene.clipAssetKey);
  }
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (video?.narrationAssetKey) await storage.delete(video.narrationAssetKey);
  if (video?.finalAssetKey) await storage.delete(video.finalAssetKey);
  await storage.delete(assetKeys.thumbnail(videoId));
}
