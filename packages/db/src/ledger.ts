import { and, eq, sql } from "drizzle-orm";
import { newId } from "@fav/core";
import type { Db } from "./client.js";
import { creditLedger, organizations } from "./schema.js";

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number
  ) {
    super(`Insufficient credits: need ${required}, have ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

/** True balance: SUM over the append-only ledger (FAV-303 — no mutable balance column). */
export async function computeBalance(db: Db, orgId: string): Promise<number> {
  const rows = await db
    .select({ balance: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId));
  return rows[0]?.balance ?? 0;
}

/** Refresh the cached balance on the org row from the ledger. */
export async function refreshCachedBalance(db: Db, orgId: string): Promise<number> {
  const balance = await computeBalance(db, orgId);
  await db
    .update(organizations)
    .set({ cachedBalance: balance, balanceUpdatedAt: new Date() })
    .where(eq(organizations.id, orgId));
  return balance;
}

export interface LedgerEntryInput {
  orgId: string;
  entryType: (typeof creditLedger.$inferInsert)["entryType"];
  amount: number;
  jobId?: string;
  videoId?: string;
  stripeEventId?: string;
  reason?: string;
  createdByUserId?: string;
  metadata?: Record<string, unknown>;
}

export async function appendLedgerEntry(db: Db, input: LedgerEntryInput) {
  const [row] = await db
    .insert(creditLedger)
    .values({ id: newId("led"), ...input })
    .returning();
  await refreshCachedBalance(db, input.orgId);
  return row!;
}

/**
 * Race-safe reservation (FAV-1205, FAV-904): the insert is guarded by a
 * balance recheck inside a single INSERT ... SELECT, so two concurrent
 * reservations cannot both pass a stale balance check. The unique
 * (job_id, entry_type) index makes retries idempotent (FAV-903).
 */
export async function reserveCredits(
  db: Db,
  args: { orgId: string; jobId: string; videoId?: string; amount: number; reason?: string }
): Promise<{ reserved: boolean; balance: number }> {
  if (args.amount <= 0) throw new Error("Reservation amount must be positive");

  const existing = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(and(eq(creditLedger.jobId, args.jobId), eq(creditLedger.entryType, "reservation")));
  if (existing.length > 0) {
    return { reserved: true, balance: await computeBalance(db, args.orgId) };
  }

  const id = newId("led");
  // Insert the negative reservation only if the current ledger sum covers it.
  const inserted = await db.execute(sql`
    INSERT INTO credit_ledger (id, org_id, entry_type, amount, job_id, video_id, reason)
    SELECT ${id}, ${args.orgId}, 'reservation', ${-args.amount}, ${args.jobId}, ${args.videoId ?? null}, ${args.reason ?? null}
    WHERE (
      SELECT coalesce(sum(amount), 0) FROM credit_ledger WHERE org_id = ${args.orgId}
    ) >= ${args.amount}
    RETURNING id
  `);
  const rows = (inserted as { rows?: unknown[] }).rows ?? [];
  const balance = await refreshCachedBalance(db, args.orgId);
  if (rows.length === 0) {
    throw new InsufficientCreditsError(args.amount, balance);
  }
  return { reserved: true, balance };
}

/**
 * Finalize on success (FAV-904): the reservation stands as the charge; if the
 * actual cost came in under the reserve, release the difference.
 */
export async function finalizeCredits(
  db: Db,
  args: { orgId: string; jobId: string; videoId?: string; actualCost: number }
): Promise<{ charged: number }> {
  const [reservation] = await db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.jobId, args.jobId), eq(creditLedger.entryType, "reservation")));
  if (!reservation) throw new Error(`No reservation found for job ${args.jobId}`);

  const reserved = -reservation.amount;
  const release = reserved - args.actualCost;
  if (release > 0) {
    await appendLedgerEntry(db, {
      orgId: args.orgId,
      entryType: "reservation_release",
      amount: release,
      jobId: args.jobId,
      videoId: args.videoId,
      reason: `Released unused reserve (reserved ${reserved}, actual ${args.actualCost})`
    });
  }
  return { charged: Math.min(reserved, args.actualCost) };
}

/** Full compensating refund on terminal failure (FAV-904 AC, FAV-808). */
export async function refundCredits(
  db: Db,
  args: { orgId: string; jobId: string; videoId?: string; reason?: string }
): Promise<{ refunded: number }> {
  const [reservation] = await db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.jobId, args.jobId), eq(creditLedger.entryType, "reservation")));
  if (!reservation) return { refunded: 0 };

  const [existingRefund] = await db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.jobId, args.jobId), eq(creditLedger.entryType, "refund")));
  if (existingRefund) return { refunded: existingRefund.amount };

  const amount = -reservation.amount;
  await appendLedgerEntry(db, {
    orgId: args.orgId,
    entryType: "refund",
    amount,
    jobId: args.jobId,
    videoId: args.videoId,
    reason: args.reason ?? "Generation failed — automatic refund"
  });
  return { refunded: amount };
}
