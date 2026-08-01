import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { appendLedgerEntry, getDb, jobs, refundCredits } from "@fav/db";
import { newId } from "@fav/core";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";
import { kickGenerationJob, kickPublishJob, kickRerollJob } from "@/lib/runner";

const actionSchema = z.object({
  action: z.enum(["retry", "refund", "adjust"]),
  /** For adjust: signed credit amount + reason. */
  amount: z.number().int().optional(),
  reason: z.string().max(300).optional()
});

/** Manual operator actions on a job (FAV-1702): retry, refund, credit adjustment. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireStaff();
    const { id } = await ctx.params;
    const db = getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const parsed = actionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    switch (parsed.data.action) {
      case "retry": {
        if (job.status === "running") {
          return NextResponse.json({ error: "Job is still running" }, { status: 409 });
        }
        await db.update(jobs).set({ status: "queued", error: null }).where(eq(jobs.id, id));
        if (job.kind === "generation") kickGenerationJob(id);
        else if (job.kind === "reroll") kickRerollJob(id);
        else if (job.kind === "publish") kickPublishJob(id);
        else return NextResponse.json({ error: `Cannot retry ${job.kind} jobs` }, { status: 400 });
        return NextResponse.json({ ok: true, retried: true });
      }
      case "refund": {
        // Manual refund writes a ledger entry (FAV-1702 AC).
        const { refunded } = await refundCredits(db, {
          orgId: job.orgId,
          jobId: id,
          videoId: job.videoId ?? undefined,
          reason: parsed.data.reason ?? `Manual refund by ${session.user.email}`
        });
        return NextResponse.json({ ok: true, refunded });
      }
      case "adjust": {
        if (!parsed.data.amount) return NextResponse.json({ error: "amount required" }, { status: 400 });
        await appendLedgerEntry(db, {
          orgId: job.orgId,
          entryType: "adjustment",
          amount: parsed.data.amount,
          reason: parsed.data.reason ?? `Manual adjustment by ${session.user.email}`,
          createdByUserId: session.userId,
          metadata: { adjustmentId: newId("adj") }
        });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
