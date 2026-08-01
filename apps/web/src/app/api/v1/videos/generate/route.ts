import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { estimateVideoCost, FLAG_KEYS, videoRequestSchema } from "@fav/core";
import { getDb, isFeatureEnabled, organizations } from "@fav/db";
import { getRateLimiter } from "@fav/providers";
import { createGenerationJob } from "@fav/workflows";
import { authenticateApiKey, hasScope } from "@/lib/api-key";
import { kickGenerationJob } from "@/lib/runner";

/**
 * Public API (FAV-1502): POST /api/v1/videos/generate — async, returns ids to
 * poll. Auth via API key, per-org rate limiting + credit metering (FAV-1503).
 */
export async function POST(req: NextRequest) {
  const ctx = await authenticateApiKey(req.headers.get("authorization"));
  if (!ctx) return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  if (!hasScope(ctx, "videos:write")) {
    return NextResponse.json({ error: "Key lacks videos:write scope" }, { status: 403 });
  }
  // Checked per request, not just at key issuance: turning the flag off must
  // immediately stop existing keys from working (FAV-1703).
  if (!(await isFeatureEnabled(getDb(), FLAG_KEYS.publicApi, ctx.orgId))) {
    return NextResponse.json({ error: "api_disabled" }, { status: 403 });
  }

  // Per-org API rate limit with retry info (FAV-1503 AC).
  const limiter = getRateLimiter("api-generate", 20, 60_000);
  const limit = await limiter.check(ctx.orgId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded", retryAfterSeconds: limit.retryAfterSeconds },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
    );
  }

  const parsed = videoRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  if (parsed.data.tier === "max" && !(await isFeatureEnabled(db, FLAG_KEYS.textToVideo, ctx.orgId))) {
    return NextResponse.json({ error: "tier_not_enabled" }, { status: 403 });
  }
  const estimate = estimateVideoCost(parsed.data);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org || org.cachedBalance < estimate.total) {
    return NextResponse.json(
      { error: "insufficient_credits", required: estimate.total, available: org?.cachedBalance ?? 0 },
      { status: 402 }
    );
  }

  const { videoId, jobId } = await createGenerationJob(db, { orgId: ctx.orgId, request: parsed.data });
  kickGenerationJob(jobId);
  return NextResponse.json({ id: videoId, jobId, status: "queued", estimatedCredits: estimate.total }, { status: 202 });
}
