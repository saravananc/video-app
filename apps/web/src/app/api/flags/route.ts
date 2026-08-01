import { NextResponse } from "next/server";
import { getDb, resolveFlags } from "@fav/db";
import { authErrorResponse, requireSession } from "@/lib/org";

export const dynamic = "force-dynamic";

/** Resolved flags for the caller's org, so the UI hides gated controls (FAV-1703). */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ flags: await resolveFlags(getDb(), session.orgId) });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
