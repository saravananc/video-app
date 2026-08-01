import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb, jobs, scenes, videos } from "@fav/db";
import { overallPercent, STAGE_LABELS, pipelineStageSchema } from "@fav/core";
import { getStorageProvider } from "@fav/providers";
import { authErrorResponse, requireSession } from "@/lib/org";

export const dynamic = "force-dynamic";

/**
 * User-initiated deletion (FAV-1606). Every stored asset is purged and the
 * user's content (topic, script, captions) is scrubbed, but the row is
 * soft-deleted rather than dropped: credit_ledger entries reference it and
 * that ledger is append-only and auditable by design (FAV-303). Deleted
 * videos are invisible to every read path.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireSession();
    const { id } = await ctx.params;
    const db = getDb();
    const [video] = await db
      .select({ id: videos.id, status: videos.status, deletedAt: videos.deletedAt })
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.orgId, orgId)));
    if (!video || video.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (video.status === "generating" || video.status === "rendering" || video.status === "queued") {
      return NextResponse.json({ error: "Wait for generation to finish before deleting" }, { status: 409 });
    }

    const { purgeVideoAssets } = await import("@fav/workflows");
    const { getStorageProvider } = await import("@fav/providers");
    await purgeVideoAssets(db, getStorageProvider(), id);
    await db.delete(scenes).where(eq(scenes.videoId, id));
    await db
      .update(videos)
      .set({
        deletedAt: new Date(),
        title: "Deleted video",
        topic: "",
        script: null,
        captionCues: null,
        finalAssetKey: null,
        narrationAssetKey: null,
        thumbnailAssetKey: null,
        playbackId: null,
        updatedAt: new Date()
      })
      .where(eq(videos.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

/** Video detail + live job progress + scenes (FAV-1104 poll target). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let orgId: string;
  try {
    ({ orgId } = await requireSession());
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
  const db = getDb();

  const [video] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.orgId, orgId), isNull(videos.deletedAt)));
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.videoId, id), eq(jobs.kind, "generation")))
    .orderBy(desc(jobs.createdAt))
    .limit(1);

  const sceneRows = await db
    .select({
      id: scenes.id,
      index: scenes.index,
      narration: scenes.narration,
      visualPrompt: scenes.visualPrompt,
      onScreenText: scenes.onScreenText,
      status: scenes.status,
      imageAssetKey: scenes.imageAssetKey,
      audioStartSec: scenes.audioStartSec,
      audioEndSec: scenes.audioEndSec
    })
    .from(scenes)
    .where(eq(scenes.videoId, id))
    .orderBy(asc(scenes.index));

  const stageParse = job?.stage ? pipelineStageSchema.safeParse(job.stage) : null;
  const progress =
    job && stageParse?.success
      ? {
          stage: job.stage,
          stageLabel: STAGE_LABELS[stageParse.data],
          stageProgress: job.stageProgress,
          percent: overallPercent({ stage: stageParse.data, stageProgress: job.stageProgress }),
          detail: job.detail
        }
      : null;

  const storage = getStorageProvider();
  const [finalUrl, sceneImages] = await Promise.all([
    video.finalAssetKey ? storage.getSignedUrl(video.finalAssetKey, 3600) : Promise.resolve(null),
    Promise.all(
      sceneRows.map(async (s) => (s.imageAssetKey ? storage.getSignedUrl(s.imageAssetKey, 3600) : null))
    )
  ]);

  return NextResponse.json({
    video: {
      id: video.id,
      title: video.title,
      topic: video.topic,
      status: video.status,
      request: video.request,
      durationSeconds: video.durationSeconds,
      creditsEstimated: video.creditsEstimated,
      creditsCharged: video.creditsCharged,
      errorMessage: video.errorMessage,
      finalUrl,
      createdAt: video.createdAt,
      completedAt: video.completedAt
    },
    job: job
      ? { id: job.id, status: job.status, attempts: job.attempts, error: job.error, progress }
      : null,
    scenes: sceneRows.map((s, i) => ({ ...s, imageUrl: sceneImages[i] }))
  });
}
