import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { FLAG_KEYS, newId } from "@fav/core";
import { autopilotRules, getDb } from "@fav/db";
import { computeNextRun } from "@fav/workflows";
import { authErrorResponse, requireFeature, requireVideoAccess } from "@/lib/org";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireVideoAccess();
    const rows = await getDb()
      .select()
      .from(autopilotRules)
      .where(eq(autopilotRules.orgId, session.orgId))
      .orderBy(desc(autopilotRules.createdAt));
    return NextResponse.json({
      rules: rows.map((r) => ({
        id: r.id,
        name: r.name,
        niche: r.niche,
        cadence: r.cadence,
        socialAccountId: r.socialAccountId,
        enabled: r.enabled,
        requiresReview: r.requiresReview,
        nextRunAt: r.nextRunAt,
        lastRunAt: r.lastRunAt
      }))
    });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

const ruleSchema = z.object({
  name: z.string().min(1).max(80),
  niche: z.string().min(2).max(200),
  cadence: z.string().regex(/^(daily|weekly|every:\d+[hd])$/),
  socialAccountId: z.string().optional(),
  requiresReview: z.boolean().default(false),
  videoDefaults: z.record(z.unknown()).optional()
});

/** Autopilot rule builder (FAV-1401): niche + cadence + platform, next-run scheduled. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireVideoAccess();
    await requireFeature(session.orgId, FLAG_KEYS.autopilot);
    const parsed = ruleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const id = newId("apr");
    await getDb()
      .insert(autopilotRules)
      .values({
        id,
        orgId: session.orgId,
        name: parsed.data.name,
        niche: parsed.data.niche,
        cadence: parsed.data.cadence,
        socialAccountId: parsed.data.socialAccountId,
        requiresReview: parsed.data.requiresReview,
        videoDefaults: parsed.data.videoDefaults,
        enabled: true,
        nextRunAt: computeNextRun(parsed.data.cadence, new Date())
      });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
