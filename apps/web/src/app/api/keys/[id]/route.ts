import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiKeys, getDb } from "@fav/db";
import { authErrorResponse, requireBillingAccess } from "@/lib/org";

/** Revoke an API key (FAV-1501): revoked keys fail auth immediately. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireBillingAccess();
    const { id } = await ctx.params;
    const db = getDb();
    const [existing] = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, session.orgId)));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
