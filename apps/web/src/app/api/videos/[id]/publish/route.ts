import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, publishJobs, socialAccounts, videos } from "@fav/db";
import { createPublishJob } from "@fav/workflows";
import type { Platform } from "@fav/providers";
import { kickPublishJob } from "@/lib/runner";
import { authErrorResponse, requireVideoAccess } from "@/lib/org";

const publishSchema = z.object({
  socialAccountId: z.string(),
  title: z.string().min(1).max(100),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(30)).max(30).optional(),
  visibility: z.enum(["public", "unlisted", "private"]).default("public")
});

/** Publish the finished video to a connected account (FAV-1302/1306). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVideoAccess();
    const { id } = await ctx.params;
    const db = getDb();

    const [video] = await db
      .select({ id: videos.id, status: videos.status, finalAssetKey: videos.finalAssetKey })
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.orgId, session.orgId)));
    if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (video.status !== "completed" || !video.finalAssetKey) {
      return NextResponse.json({ error: "Video must be completed before publishing" }, { status: 409 });
    }

    const parsed = publishSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const [account] = await db
      .select()
      .from(socialAccounts)
      .where(and(eq(socialAccounts.id, parsed.data.socialAccountId), eq(socialAccounts.orgId, session.orgId)));
    if (!account) return NextResponse.json({ error: "Account not connected" }, { status: 404 });
    if (account.status !== "connected") {
      return NextResponse.json({ error: "Account needs to be reconnected" }, { status: 409 });
    }

    const { publishJobId } = await createPublishJob(db, {
      orgId: session.orgId,
      videoId: id,
      socialAccountId: account.id,
      platform: account.platform as Platform,
      title: parsed.data.title,
      description: parsed.data.description,
      tags: parsed.data.tags,
      visibility: parsed.data.visibility
    });
    kickPublishJob(publishJobId);
    return NextResponse.json({ publishJobId }, { status: 202 });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

/** Publish history for this video — status visible in UI (FAV-1306 AC). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVideoAccess();
    const { id } = await ctx.params;
    const db = getDb();
    const rows = await db
      .select({
        id: publishJobs.id,
        platform: publishJobs.platform,
        status: publishJobs.status,
        title: publishJobs.title,
        externalPostId: publishJobs.externalPostId,
        error: publishJobs.error,
        attempts: publishJobs.attempts,
        publishedAt: publishJobs.publishedAt,
        createdAt: publishJobs.createdAt
      })
      .from(publishJobs)
      .where(and(eq(publishJobs.videoId, id), eq(publishJobs.orgId, session.orgId)))
      .orderBy(desc(publishJobs.createdAt));
    return NextResponse.json({ publishes: rows });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
