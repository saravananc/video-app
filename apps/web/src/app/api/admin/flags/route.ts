import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { featureFlags, getDb } from "@fav/db";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** Feature flags (FAV-1703): list + runtime toggles, gated to staff. */
export async function GET() {
  try {
    await requireStaff();
    const flags = await getDb().select().from(featureFlags);
    return NextResponse.json({ flags });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

const toggleSchema = z.object({ key: z.string(), defaultOn: z.boolean() });

export async function PATCH(req: NextRequest) {
  try {
    await requireStaff();
    const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const db = getDb();
    const updated = await db
      .update(featureFlags)
      .set({ defaultOn: parsed.data.defaultOn })
      .where(eq(featureFlags.key, parsed.data.key))
      .returning();
    if (updated.length === 0) return NextResponse.json({ error: "Unknown flag" }, { status: 404 });
    return NextResponse.json({ ok: true, flag: updated[0] });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
