import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { newId, packById, planById } from "@fav/core";
import { appendLedgerEntry, getDb, invoices, organizations, webhookEvents } from "@fav/db";
import type { Db } from "@fav/db";
import { getPaymentsProvider, WebhookVerificationError } from "@fav/providers";

/** Record an invoice line for the billing history (FAV-1206). */
async function recordInvoice(
  db: Db,
  args: {
    orgId: string;
    externalId: string;
    description: string;
    amountCents: number;
    creditsGranted?: number;
  }
): Promise<void> {
  await db
    .insert(invoices)
    .values({ id: newId("inv"), status: "paid", ...args })
    .onConflictDoNothing({ target: invoices.externalId });
}

/**
 * Payment webhooks -> credit ledger (FAV-1202): signature verified by the
 * provider adapter, idempotent via the webhook_events primary key, one ledger
 * entry per grant. The mock checkout in dev posts to this same endpoint.
 */
export async function POST(req: NextRequest) {
  const payments = getPaymentsProvider();
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") ?? req.headers.get("x-fav-signature");

  let event;
  try {
    event = await payments.parseWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const db = getDb();

  // Idempotent event handling (FAV-1202 AC): first insert wins, replays no-op.
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider: payments.name, externalId: event.id, type: event.type })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (!event.orgId) return NextResponse.json({ ok: true, ignored: true });

  switch (event.type) {
    case "checkout.completed.plan": {
      const plan = planById(event.itemId ?? "");
      if (!plan) break;
      await db
        .update(organizations)
        .set({
          plan: plan.id,
          stripeCustomerId: event.customerId,
          stripeSubscriptionId: event.subscriptionId,
          updatedAt: new Date()
        })
        .where(eq(organizations.id, event.orgId));
      await appendLedgerEntry(db, {
        orgId: event.orgId,
        entryType: "grant",
        amount: plan.monthlyCredits,
        stripeEventId: event.id,
        reason: `${plan.name} subscription started`
      });
      await recordInvoice(db, {
        orgId: event.orgId,
        externalId: event.id,
        description: `${plan.name} plan — subscription`,
        amountCents: plan.priceCents,
        creditsGranted: plan.monthlyCredits
      });
      break;
    }
    case "checkout.completed.pack": {
      const pack = packById(event.itemId ?? "");
      if (!pack) break;
      // Top-up credits never expire (FAV-1203 AC): purchase entries are never reset.
      await appendLedgerEntry(db, {
        orgId: event.orgId,
        entryType: "purchase",
        amount: pack.credits,
        stripeEventId: event.id,
        reason: `${pack.name} top-up`
      });
      await recordInvoice(db, {
        orgId: event.orgId,
        externalId: event.id,
        description: `${pack.name} — ${pack.credits} credits`,
        amountCents: pack.priceCents,
        creditsGranted: pack.credits
      });
      break;
    }
    case "subscription.renewed": {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, event.orgId));
      const plan = org ? planById(org.plan) : undefined;
      if (!plan || plan.monthlyCredits === 0) break;
      // Monthly reset (FAV-1204): grant the cycle's allotment; purchases persist.
      await appendLedgerEntry(db, {
        orgId: event.orgId,
        entryType: "reset",
        amount: plan.monthlyCredits,
        stripeEventId: event.id,
        reason: `${plan.name} monthly credit reset`
      });
      await recordInvoice(db, {
        orgId: event.orgId,
        externalId: event.id,
        description: `${plan.name} plan — monthly renewal`,
        amountCents: plan.priceCents,
        creditsGranted: plan.monthlyCredits
      });
      break;
    }
    case "subscription.canceled": {
      await db
        .update(organizations)
        .set({ plan: "free", stripeSubscriptionId: null, updatedAt: new Date() })
        .where(eq(organizations.id, event.orgId));
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ ok: true });
}
