import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { newId, STARTER_CREDITS, type Role } from "@fav/core";
import { appendLedgerEntry, getDb, memberships, organizations, users } from "@fav/db";

export const SESSION_COOKIE = "fav_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

function secret(): string {
  return process.env.FAV_SESSION_SECRET ?? "dev-session-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Signed local session token: userId.expiresAt.hmac (FAV-201 dev fallback). */
export function createSessionToken(userId: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAt, signature] = parts as [string, string, string];
  if (Number(expiresAt) < Date.now()) return null;
  const expected = sign(`${userId}.${expiresAt}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

export interface Session {
  userId: string;
  orgId: string;
  role: Role;
  user: { id: string; email: string; name: string | null; isStaff: boolean };
  org: { id: string; name: string; plan: string; cachedBalance: number };
}

/**
 * Resolve the current session (FAV-204). Local cookie sessions in dev; when
 * Clerk keys are configured the Clerk middleware population takes precedence
 * (its user id lands in the same users.auth_provider_id mapping).
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  const session = await sessionForUser(userId);
  if (!session) return null;

  // Audited support impersonation (FAV-1704): staff with an active, unexpired
  // impersonation session act inside the target org (as admin, not owner).
  const impersonationId = jar.get("fav_impersonate")?.value;
  if (impersonationId && session.user.isStaff) {
    const db = getDb();
    const { impersonationSessions, organizations: orgsTable } = await import("@fav/db");
    const [imp] = await db
      .select()
      .from(impersonationSessions)
      .where(eq(impersonationSessions.id, impersonationId));
    if (
      imp &&
      imp.staffUserId === userId &&
      !imp.endedAt &&
      imp.expiresAt.getTime() > Date.now()
    ) {
      const [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, imp.targetOrgId));
      if (org) {
        return {
          ...session,
          orgId: org.id,
          role: "admin",
          org: { id: org.id, name: `${org.name} (impersonating)`, plan: org.plan, cachedBalance: org.cachedBalance }
        };
      }
    }
  }
  return session;
}

export async function sessionForUser(userId: string): Promise<Session | null> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const rows = await db
    .select({
      orgId: memberships.orgId,
      role: memberships.role,
      orgName: organizations.name,
      plan: organizations.plan,
      cachedBalance: organizations.cachedBalance
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, userId));
  const membership = rows[0];
  if (!membership) return null;
  return {
    userId,
    orgId: membership.orgId,
    role: membership.role,
    user: { id: user.id, email: user.email, name: user.name, isStaff: user.isStaff },
    org: {
      id: membership.orgId,
      name: membership.orgName,
      plan: membership.plan,
      cachedBalance: membership.cachedBalance
    }
  };
}

/**
 * First-signup provisioning (FAV-202/1208): create the user, auto-create their
 * org, owner membership, and grant starter credits — no card required.
 */
export async function provisionUser(args: {
  authProviderId: string;
  email: string;
  name?: string;
}): Promise<{ userId: string; orgId: string }> {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.authProviderId, args.authProviderId));
  if (existing) {
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, existing.id));
    if (membership) return { userId: existing.id, orgId: membership.orgId };
  }

  const userId = existing?.id ?? newId("user");
  const orgId = newId("org");
  if (!existing) {
    await db.insert(users).values({
      id: userId,
      authProviderId: args.authProviderId,
      email: args.email,
      name: args.name
    });
  }
  const orgName = args.name ? `${args.name}'s Studio` : "My Studio";
  await db.insert(organizations).values({
    id: orgId,
    name: orgName,
    slug: `${orgId.replace("org_", "")}`
  });
  await db.insert(memberships).values({ id: newId("mem"), orgId, userId, role: "owner" });
  await appendLedgerEntry(db, {
    orgId,
    entryType: "grant",
    amount: STARTER_CREDITS,
    reason: "Starter credits on signup"
  });
  return { userId, orgId };
}
