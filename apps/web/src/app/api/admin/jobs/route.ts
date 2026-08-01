import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, jobs } from "@fav/db";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** Job monitoring (FAV-1702): list with states + errors, filterable by status. */
export async function GET(req: NextRequest) {
  try {
    await requireStaff();
    const db = getDb();
    const status = req.nextUrl.searchParams.get("status");
    const valid = ["queued", "running", "completed", "failed", "canceled"] as const;
    const filter = valid.find((s) => s === status);

    const rows = await db
      .select({
        id: jobs.id,
        orgId: jobs.orgId,
        videoId: jobs.videoId,
        kind: jobs.kind,
        status: jobs.status,
        stage: jobs.stage,
        stageProgress: jobs.stageProgress,
        error: jobs.error,
        attempts: jobs.attempts,
        createdAt: jobs.createdAt,
        finishedAt: jobs.finishedAt
      })
      .from(jobs)
      .where(filter ? eq(jobs.status, filter) : undefined)
      .orderBy(desc(jobs.createdAt))
      .limit(100);
    return NextResponse.json({ jobs: rows });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
