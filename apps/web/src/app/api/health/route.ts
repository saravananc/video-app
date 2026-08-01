import { NextResponse } from "next/server";
import { getDb, organizations } from "@fav/db";

export const dynamic = "force-dynamic";

/** Liveness + DB connectivity probe. Migrations/seed run at server startup (next.config.ts). */
export async function GET() {
  try {
    const db = getDb();
    const orgs = await db.select({ id: organizations.id }).from(organizations).limit(1);
    return NextResponse.json({ ok: true, db: "up", seeded: orgs.length > 0 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
