import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "@fav/core";
import { provisionExternalUser } from "./auth";

/**
 * Clerk integration (FAV-201), active only when CLERK_SECRET_KEY is set.
 *
 * Clerk owns identity; this app owns orgs, roles, and credits. The bridge is
 * `users.auth_provider_id` — a Clerk user id lands there via
 * provisionExternalUser, which creates the org, owner membership, and starter
 * credits exactly as local signup does. Built-in email/password auth stays the
 * default so the app runs with no third-party account.
 */

export function clerkEnabled(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

interface ClerkUser {
  id: string;
  email_addresses?: Array<{ email_address: string; verification?: { status?: string } }>;
  primary_email_address_id?: string;
  first_name?: string | null;
  last_name?: string | null;
}

function primaryEmail(user: ClerkUser): string | undefined {
  const addresses = user.email_addresses ?? [];
  const primary = addresses.find((a) => a.email_address) ?? addresses[0];
  return primary?.email_address;
}

function displayName(user: ClerkUser): string | undefined {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : undefined;
}

/** Fetch a Clerk user by id, used to resolve a session into a local account. */
export async function fetchClerkUser(userId: string): Promise<ClerkUser | null> {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: { authorization: `Bearer ${key}` }
  });
  if (!res.ok) {
    logger.warn("clerk_user_fetch_failed", { status: res.status, clerkUserId: userId });
    return null;
  }
  return (await res.json()) as ClerkUser;
}

/**
 * Map a Clerk user onto a local account, creating it on first sight.
 * Idempotent: provisionExternalUser returns the existing membership if the
 * auth_provider_id is already known.
 */
export async function syncClerkUser(userId: string): Promise<{ userId: string; orgId: string } | null> {
  const clerkUser = await fetchClerkUser(userId);
  if (!clerkUser) return null;
  const email = primaryEmail(clerkUser);
  if (!email) {
    logger.warn("clerk_user_without_email", { clerkUserId: userId });
    return null;
  }
  return provisionExternalUser({
    authProviderId: `clerk:${clerkUser.id}`,
    email,
    name: displayName(clerkUser)
  });
}

/**
 * Verify a Clerk webhook (Svix signature scheme) so user.created /
 * user.deleted events can keep local accounts in step.
 */
export function verifyClerkWebhook(args: {
  payload: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}): boolean {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret || !args.svixId || !args.svixTimestamp || !args.svixSignature) return false;

  // Reject stale deliveries so a captured request can't be replayed later.
  const age = Math.abs(Date.now() - Number(args.svixTimestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60_000) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${args.svixId}.${args.svixTimestamp}.${args.payload}`)
    .digest("base64");

  // The header carries space-separated "v1,<sig>" entries.
  return args.svixSignature.split(" ").some((entry) => {
    const signature = entry.split(",")[1];
    if (!signature) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
