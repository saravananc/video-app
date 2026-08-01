import { NextResponse } from "next/server";
import { getDb } from "@fav/db";
import { getStorageProvider } from "@fav/providers";
import { runMaintenance, RETENTION } from "@fav/workflows";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/**
 * Manual/cron trigger for the retention pass (FAV-1003/1606): expires
 * intermediate assets and scrubs long-soft-deleted videos. Point an external
 * cron here in production; dev runs it on an interval.
 */
export async function POST() {
  try {
    await requireStaff();
    const result = await runMaintenance(getDb(), getStorageProvider());
    return NextResponse.json({ ...result, policy: RETENTION });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
