import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, jobs, videos } from "@fav/db";
import { overallPercent, pipelineStageSchema } from "@fav/core";
import { getStorageProvider } from "@fav/providers";
import { authenticateApiKey, hasScope } from "@/lib/api-key";

/** Public API (FAV-1502): GET /api/v1/videos/{id} — poll to completion. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  if (!hasScope(auth, "videos:read")) {
    return NextResponse.json({ error: "Key lacks videos:read scope" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const db = getDb();
  const [video] = await db
    .select()
    .from(videos)
    .where(and(eq(videos.id, id), eq(videos.orgId, auth.orgId), isNull(videos.deletedAt)));
  if (!video) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.videoId, id), eq(jobs.kind, "generation")))
    .orderBy(desc(jobs.createdAt))
    .limit(1);

  const stageParse = job?.stage ? pipelineStageSchema.safeParse(job.stage) : null;
  const percent =
    job && stageParse?.success
      ? overallPercent({ stage: stageParse.data, stageProgress: job.stageProgress })
      : null;

  const downloadUrl =
    video.status === "completed" && video.finalAssetKey
      ? await getStorageProvider().getSignedUrl(video.finalAssetKey, 3600)
      : null;

  return NextResponse.json({
    id: video.id,
    status: video.status,
    title: video.title,
    topic: video.topic,
    durationSeconds: video.durationSeconds,
    creditsCharged: video.creditsCharged,
    progressPercent: percent,
    error: video.errorMessage,
    downloadUrl,
    createdAt: video.createdAt,
    completedAt: video.completedAt
  });
}
