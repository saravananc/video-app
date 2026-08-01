import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, socialAccounts } from "@fav/db";
import { refreshExpiringTokens } from "@fav/workflows";
import { authErrorResponse, requireSession } from "@/lib/org";

export const dynamic = "force-dynamic";

/** Connected social accounts; opportunistically refreshes expiring tokens (FAV-1305). */
export async function GET() {
  try {
    const session = await requireSession();
    const db = getDb();
    await refreshExpiringTokens(db).catch(() => undefined);
    const rows = await db
      .select({
        id: socialAccounts.id,
        platform: socialAccounts.platform,
        displayName: socialAccounts.displayName,
        status: socialAccounts.status,
        tokenExpiresAt: socialAccounts.tokenExpiresAt,
        createdAt: socialAccounts.createdAt
      })
      .from(socialAccounts)
      .where(eq(socialAccounts.orgId, session.orgId));
    return NextResponse.json({ accounts: rows });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
