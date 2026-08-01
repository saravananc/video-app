import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { autopilotRules, autopilotRuns, getDb } from "@fav/db";
import { computeNextRun } from "@fav/workflows";
import { authErrorResponse, requireVideoAccess } from "@/lib/org";

export const dynamic = "force-dynamic";

/** Rule detail + run history (FAV-1405). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVideoAccess();
    const { id } = await ctx.params;
    const db = getDb();
    const [rule] = await db
      .select()
      .from(autopilotRules)
      .where(and(eq(autopilotRules.id, id), eq(autopilotRules.orgId, session.orgId)));
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const runs = await db
      .select()
      .from(autopilotRuns)
      .where(eq(autopilotRuns.ruleId, id))
      .orderBy(desc(autopilotRuns.startedAt))
      .limit(30);
    return NextResponse.json({ rule, runs });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  cadence: z.string().regex(/^(daily|weekly|every:\d+[hd])$/).optional(),
  requiresReview: z.boolean().optional()
});

/** Pause/resume + edit (FAV-1401/1405 AC). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVideoAccess();
    const { id } = await ctx.params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const db = getDb();
    const [rule] = await db
      .select()
      .from(autopilotRules)
      .where(and(eq(autopilotRules.id, id), eq(autopilotRules.orgId, session.orgId)));
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const changes: Partial<typeof autopilotRules.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.enabled !== undefined) {
      changes.enabled = parsed.data.enabled;
      // Resuming reschedules from now — no burst of missed runs (FAV-1402 AC).
      if (parsed.data.enabled) changes.nextRunAt = computeNextRun(rule.cadence, new Date());
    }
    if (parsed.data.cadence) {
      changes.cadence = parsed.data.cadence;
      changes.nextRunAt = computeNextRun(parsed.data.cadence, new Date());
    }
    if (parsed.data.requiresReview !== undefined) changes.requiresReview = parsed.data.requiresReview;
    await db.update(autopilotRules).set(changes).where(eq(autopilotRules.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVideoAccess();
    const { id } = await ctx.params;
    const db = getDb();
    const [rule] = await db
      .select({ id: autopilotRules.id })
      .from(autopilotRules)
      .where(and(eq(autopilotRules.id, id), eq(autopilotRules.orgId, session.orgId)));
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.delete(autopilotRules).where(eq(autopilotRules.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
