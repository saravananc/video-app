import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { newId } from "@fav/core";
import type { Db } from "./client.js";
import { authTokens } from "./schema.js";

export type TokenPurpose = "email_verification" | "password_reset";

const TTL_MS: Record<TokenPurpose, number> = {
  email_verification: 24 * 3600 * 1000,
  // Short-lived: a reset link is a password equivalent while it's valid.
  password_reset: 60 * 60 * 1000
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a single-use token, invalidating any outstanding ones for the same
 * purpose so an older link can't be replayed after a new one is requested.
 */
export async function issueAuthToken(
  db: Db,
  userId: string,
  purpose: TokenPurpose,
  token: string
): Promise<{ expiresAt: Date }> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), sql`${authTokens.usedAt} IS NULL`));

  const expiresAt = new Date(Date.now() + TTL_MS[purpose]);
  await db.insert(authTokens).values({
    id: newId("atk"),
    userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt
  });
  return { expiresAt };
}

/**
 * Atomically consume a token: the UPDATE ... WHERE used_at IS NULL means two
 * concurrent redemptions can't both succeed.
 */
export async function consumeAuthToken(
  db: Db,
  purpose: TokenPurpose,
  token: string
): Promise<{ userId: string } | null> {
  const hash = hashToken(token);
  const result = await db.execute(sql`
    UPDATE auth_tokens SET used_at = now()
    WHERE token_hash = ${hash}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING user_id
  `);
  const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<{ user_id: string }>;
  return rows[0] ? { userId: rows[0].user_id } : null;
}

/** Housekeeping: drop tokens that are spent or long expired. */
export async function pruneAuthTokens(db: Db): Promise<void> {
  await db.delete(authTokens).where(lt(authTokens.expiresAt, new Date(Date.now() - 7 * 24 * 3600 * 1000)));
}
