import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, videos } from "@fav/db";
import { getStorageProvider } from "@fav/providers";
import { enqueueGenerationRun, resetScriptForRegeneration } from "@fav/workflows";
import { kickGenerationJob } from "@/lib/runner";
import { authErrorResponse, requireVideoAccess } from "@/lib/org";

const regenerateSchema = z.object({
  /** true = throw away the script and start over (FAV-404 "regenerate whole"). */
  fullScript: z.boolean().default(false)
});

/** Re-run generation: after edits only stale artifacts regenerate (FAV-404/1103). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireVideoAccess();
    const { id } = await ctx.params;
    const db = getDb();
    const [video] = await db
      .select({ id: videos.id, status: videos.status })
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.orgId, orgId)));
    if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (video.status === "generating" || video.status === "rendering" || video.status === "queued") {
      return NextResponse.json({ error: "Already generating" }, { status: 409 });
    }

    const parsed = regenerateSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (parsed.success && parsed.data.fullScript) {
      await resetScriptForRegeneration(db, getStorageProvider(), id);
    }

    const { jobId } = await enqueueGenerationRun(db, { orgId, videoId: id });
    kickGenerationJob(jobId);
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
