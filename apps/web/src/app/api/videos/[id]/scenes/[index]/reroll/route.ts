import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, videos, InsufficientCreditsError } from "@fav/db";
import { createRerollJob } from "@fav/workflows";
import { kickRerollJob } from "@/lib/runner";
import { authErrorResponse, requireVideoAccess } from "@/lib/org";

/** Re-roll a single scene's visual (FAV-505) — incremental credit charge. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; index: string }> }) {
  try {
    const { orgId, userId } = await requireVideoAccess();
    const { id, index } = await ctx.params;
    const db = getDb();
    const [video] = await db
      .select({ id: videos.id, status: videos.status })
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.orgId, orgId)));
    if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (video.status === "generating" || video.status === "rendering" || video.status === "queued") {
      return NextResponse.json({ error: "Wait for the current generation to finish" }, { status: 409 });
    }

    const { jobId } = await createRerollJob(db, { orgId, videoId: id, sceneIndex: Number(index), userId });
    kickRerollJob(jobId);
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: "Insufficient credits", required: err.required, available: err.available },
        { status: 402 }
      );
    }
    throw err;
  }
}
