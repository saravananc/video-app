import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { computeBalance, creditLedger, getDb } from "@fav/db";
import { authErrorResponse, requireSession } from "@/lib/org";

export const dynamic = "force-dynamic";

/** Balance + ledger history for the billing page (FAV-1206 usage view). */
export async function GET() {
  try {
    const session = await requireSession();
    const db = getDb();
    const [balance, entries] = await Promise.all([
      computeBalance(db, session.orgId),
      db
        .select({
          id: creditLedger.id,
          entryType: creditLedger.entryType,
          amount: creditLedger.amount,
          reason: creditLedger.reason,
          videoId: creditLedger.videoId,
          createdAt: creditLedger.createdAt
        })
        .from(creditLedger)
        .where(eq(creditLedger.orgId, session.orgId))
        .orderBy(desc(creditLedger.createdAt))
        .limit(50)
    ]);
    return NextResponse.json({ balance, entries, plan: session.org.plan });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
