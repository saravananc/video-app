import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, invoices } from "@fav/db";
import { authErrorResponse, requireBillingAccess } from "@/lib/org";

export const dynamic = "force-dynamic";

/** Invoice history for the billing page (FAV-1206 AC). */
export async function GET() {
  try {
    const session = await requireBillingAccess();
    const rows = await getDb()
      .select({
        id: invoices.id,
        description: invoices.description,
        amountCents: invoices.amountCents,
        currency: invoices.currency,
        status: invoices.status,
        creditsGranted: invoices.creditsGranted,
        hostedInvoiceUrl: invoices.hostedInvoiceUrl,
        issuedAt: invoices.issuedAt
      })
      .from(invoices)
      .where(eq(invoices.orgId, session.orgId))
      .orderBy(desc(invoices.issuedAt))
      .limit(50);
    return NextResponse.json({ invoices: rows });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
