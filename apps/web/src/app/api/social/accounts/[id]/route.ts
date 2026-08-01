import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, socialAccounts } from "@fav/db";
import { authErrorResponse, requireBillingAccess } from "@/lib/org";

/** Disconnect a social account (FAV-1301 AC: disconnect flow). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireBillingAccess();
    const { id } = await ctx.params;
    const db = getDb();
    const [existing] = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.orgId, session.orgId)));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.delete(socialAccounts).where(eq(socialAccounts.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
