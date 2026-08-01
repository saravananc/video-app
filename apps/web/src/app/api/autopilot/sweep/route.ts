import { NextResponse } from "next/server";
import { getDb } from "@fav/db";
import { defaultDeps, sweepDueAutopilotRules } from "@fav/workflows";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";

/**
 * Scheduler trigger (FAV-1402): fires all due rules. Called by the in-process
 * interval in dev; production points a cron/scheduled workflow at it (or at
 * sweepDueAutopilotRules directly from a worker).
 */
export async function POST() {
  try {
    await requireStaff();
    const { fired } = await sweepDueAutopilotRules(defaultDeps(getDb()));
    return NextResponse.json({ fired });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
