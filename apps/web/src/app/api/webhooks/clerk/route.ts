import { NextRequest, NextResponse } from "next/server";
import { logger } from "@fav/core";
import { getDb, webhookEvents } from "@fav/db";
import { clerkEnabled, syncClerkUser, verifyClerkWebhook } from "@/lib/clerk";

/**
 * Clerk user lifecycle webhooks (FAV-201). Keeps local accounts in step with
 * the identity provider: a user created in Clerk gets an org, owner
 * membership, and starter credits here on first sight.
 */
export async function POST(req: NextRequest) {
  if (!clerkEnabled()) return NextResponse.json({ error: "Clerk not configured" }, { status: 404 });

  const payload = await req.text();
  const verified = verifyClerkWebhook({
    payload,
    svixId: req.headers.get("svix-id"),
    svixTimestamp: req.headers.get("svix-timestamp"),
    svixSignature: req.headers.get("svix-signature")
  });
  if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  const event = JSON.parse(payload) as { type: string; data: { id: string } };
  const db = getDb();

  // Same idempotency record the payment webhooks use.
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider: "clerk", externalId: req.headers.get("svix-id")!, type: event.type })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return NextResponse.json({ ok: true, duplicate: true });

  if (event.type === "user.created" || event.type === "session.created") {
    const result = await syncClerkUser(event.data.id);
    logger.info("clerk_user_synced", { clerkUserId: event.data.id, orgId: result?.orgId });
  }

  return NextResponse.json({ ok: true });
}
