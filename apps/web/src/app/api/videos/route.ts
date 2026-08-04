import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, isNull, lt, gt, or, ilike, type SQL } from "drizzle-orm";
import { getDb, videos, organizations, InsufficientCreditsError } from "@fav/db";
import { estimateVideoCost, FLAG_KEYS, videoRequestSchema, videoStatusSchema } from "@fav/core";
import { createGenerationJob } from "@fav/workflows";
import { getAnalytics, getRateLimiter } from "@fav/providers";
import { kickGenerationJob } from "@/lib/runner";
import { authErrorResponse, requireFeature, requireSession, requireVideoAccess } from "@/lib/org";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * List the org's videos (FAV-1101): status filter, sort, and keyset
 * pagination. Keyset rather than OFFSET so deep pages stay fast and a video
 * created mid-scroll can't cause a row to be skipped or repeated.
 */
export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireSession();
    const db = getDb();
    const params = req.nextUrl.searchParams;

    const status = videoStatusSchema.safeParse(params.get("status"));
    const search = params.get("q")?.trim();
    const sort = params.get("sort") === "oldest" ? "oldest" : "newest";
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.get("limit")) || PAGE_SIZE));
    const cursor = params.get("cursor");

    const filters: SQL[] = [eq(videos.orgId, orgId), isNull(videos.deletedAt)];
    if (status.success) filters.push(eq(videos.status, status.data));
    if (search) {
      const match = or(ilike(videos.title, `%${search}%`), ilike(videos.topic, `%${search}%`));
      if (match) filters.push(match);
    }
    // The cursor is the createdAt of the last row on the previous page.
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        filters.push(sort === "newest" ? lt(videos.createdAt, cursorDate) : gt(videos.createdAt, cursorDate));
      }
    }

    // Fetch one extra row to learn whether another page exists.
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
      .where(and(...filters))
      .orderBy(sort === "newest" ? desc(videos.createdAt) : asc(videos.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.createdAt.toISOString() : null;

    return NextResponse.json({ videos: page, nextCursor, hasMore });
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

    // Max tier means text-to-video clips — gated per org (FAV-1703/503).
    if (parsed.data.tier === "max") {
      await requireFeature(orgId, FLAG_KEYS.textToVideo);
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
    getAnalytics().capture({
      distinctId: userId,
      orgId,
      event: "video_generation_started",
      properties: {
        videoId,
        tier: parsed.data.tier,
        durationSeconds: parsed.data.durationSeconds,
        visualStyle: parsed.data.visualStyle,
        estimatedCredits: estimate.total
      }
    });
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
