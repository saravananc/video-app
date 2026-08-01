import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, videos, organizations, InsufficientCreditsError } from "@fav/db";
import { estimateVideoCost, videoRequestSchema } from "@fav/core";
import { createGenerationJob } from "@fav/workflows";
import { getRateLimiter } from "@fav/providers";
import { kickGenerationJob } from "@/lib/runner";
import { authErrorResponse, requireSession, requireVideoAccess } from "@/lib/org";

export const dynamic = "force-dynamic";

/** List the org's videos, newest first (FAV-1101). */
export async function GET() {
  try {
    const { orgId } = await requireSession();
    const db = getDb();
    const rows = await db
      .select({
        id: videos.id,
        title: videos.title,
        topic: videos.topic,
        status: videos.status,
        durationSeconds: videos.durationSeconds,
        creditsCharged: videos.creditsCharged,
        createdAt: videos.createdAt,
        completedAt: videos.completedAt
      })
      .from(videos)
      .where(and(eq(videos.orgId, orgId), isNull(videos.deletedAt)))
      .orderBy(desc(videos.createdAt))
      .limit(100);
    return NextResponse.json({ videos: rows });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

/** Create a video + start generation (FAV-1102 submit side). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireVideoAccess();
    const { orgId, userId } = session;
    const db = getDb();

    // Generation endpoint rate limit, per org (FAV-1604): 10 jobs/minute.
    const limiter = getRateLimiter("generate", 10, 60_000);
    const limit = await limiter.check(orgId);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded — try again shortly", retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = videoRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    // Pre-flight balance check for a clear early error (FAV-1205); the workflow's
    // reservation re-checks race-safely before any spend.
    const estimate = estimateVideoCost(parsed.data);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    if (org.cachedBalance < estimate.total) {
      return NextResponse.json(
        { error: "Insufficient credits", required: estimate.total, available: org.cachedBalance },
        { status: 402 }
      );
    }

    const { videoId, jobId } = await createGenerationJob(db, { orgId, userId, request: parsed.data });
    kickGenerationJob(jobId);
    return NextResponse.json({ videoId, jobId, estimate }, { status: 201 });
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
