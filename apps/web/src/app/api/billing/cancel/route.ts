import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, organizations } from "@fav/db";
import { authErrorResponse, requireBillingAccess } from "@/lib/org";

/**
 * Cancel the subscription (FAV-1206 plan management). With Stripe active this
 * cancels at the API; the mock path downgrades directly. Purchased top-up
 * credits are untouched — only future monthly grants stop.
 */
export async function POST() {
  try {
    const session = await requireBillingAccess();
    const db = getDb();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, session.orgId));
    if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (org.plan === "free") return NextResponse.json({ error: "No active subscription" }, { status: 400 });

    if (process.env.STRIPE_SECRET_KEY && org.stripeSubscriptionId) {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${org.stripeSubscriptionId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
      });
      if (!res.ok) return NextResponse.json({ error: `Stripe cancel failed: ${res.status}` }, { status: 502 });
      // The webhook (customer.subscription.deleted) performs the downgrade.
      return NextResponse.json({ ok: true, pending: true });
    }

    await db
      .update(organizations)
      .set({ plan: "free", stripeSubscriptionId: null, updatedAt: new Date() })
      .where(eq(organizations.id, session.orgId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
