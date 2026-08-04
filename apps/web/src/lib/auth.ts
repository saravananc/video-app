import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { newId, STARTER_CREDITS, type Role } from "@fav/core";
import { appendLedgerEntry, getDb, issueAuthToken, memberships, organizations, users } from "@fav/db";
import {
  generateToken,
  getEmailProvider,
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword
} from "@fav/providers";

export const SESSION_COOKIE = "fav_session";
/** Which org the user is currently acting in, when they belong to several. */
export const ACTIVE_ORG_COOKIE = "fav_org";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

/** Lockout after repeated failures (FAV-201): slows credential stuffing. */
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function secret(): string {
  const configured = process.env.FAV_SESSION_SECRET;
  if (
    !configured &&
    process.env.NODE_ENV === "production" &&
    // Same escape hatch the boot-time config check honors, so running the
    // production build locally doesn't fail only once someone tries to log in.
    process.env.FAV_ALLOW_INSECURE_DEFAULTS !== "1"
  ) {
    throw new Error("FAV_SESSION_SECRET must be set in production");
  }
  return configured ?? "dev-session-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Signed session token: userId.expiresAt.hmac. */
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

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_TTL_MS / 1000,
  path: "/"
};

export interface OrgMembershipSummary {
  id: string;
  name: string;
  role: Role;
}

export interface Session {
  userId: string;
  orgId: string;
  role: Role;
  user: { id: string; email: string; name: string | null; isStaff: boolean; emailVerified: boolean };
  org: { id: string; name: string; plan: string; cachedBalance: number };
  /** Every org this user belongs to, for the switcher (FAV-202). */
  memberships: OrgMembershipSummary[];
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  const session = await sessionForUser(userId, jar.get(ACTIVE_ORG_COOKIE)?.value);
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
    if (imp && imp.staffUserId === userId && !imp.endedAt && imp.expiresAt.getTime() > Date.now()) {
      const [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, imp.targetOrgId));
      if (org) {
        return {
          ...session,
          orgId: org.id,
          role: "admin",
          org: { id: org.id, name: `${org.name} (impersonating)`, plan: org.plan, cachedBalance: org.cachedBalance },
          // Switching is meaningless while impersonating a specific org.
          memberships: []
        };
      }
    }
  }
  return session;
}

/**
 * Build the session. When the user belongs to several orgs (FAV-202),
 * `activeOrgId` selects which one they're acting in; an unrecognised value
 * falls back to their first membership rather than failing, so a stale cookie
 * from a revoked membership can't lock anyone out.
 */
export async function sessionForUser(userId: string, activeOrgId?: string): Promise<Session | null> {
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
  if (rows.length === 0) return null;

  const membership = rows.find((r) => r.orgId === activeOrgId) ?? rows[0]!;
  return {
    userId,
    orgId: membership.orgId,
    role: membership.role,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isStaff: user.isStaff,
      emailVerified: user.emailVerifiedAt !== null
    },
    org: {
      id: membership.orgId,
      name: membership.orgName,
      plan: membership.plan,
      cachedBalance: membership.cachedBalance
    },
    memberships: rows.map((r) => ({ id: r.orgId, name: r.orgName, role: r.role }))
  };
}

function baseUrl(): string {
  return process.env.FAV_BASE_URL ?? "http://localhost:3000";
}

export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = generateToken();
  await issueAuthToken(getDb(), userId, "email_verification", token);
  await getEmailProvider().send({
    to: email,
    subject: "Verify your FAV Studio email",
    text: `Confirm your email address to finish setting up your account:\n\n${baseUrl()}/verify-email?token=${token}\n\nThis link expires in 24 hours. If you didn't sign up, you can ignore this message.`
  });
}

export class SignupError extends Error {}

/**
 * Create an account (FAV-201/202/1208): user with a hashed password, an
 * auto-created org with owner membership, and starter credits — no card.
 */
export async function signUp(args: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ userId: string; orgId: string }> {
  const email = args.email.trim().toLowerCase();
  const policy = validatePassword(args.password, email);
  if (!policy.ok) throw new SignupError(policy.message ?? "Password rejected");

  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    // Don't confirm whether an address is registered.
    throw new SignupError("If that email is available, you'll receive a verification link.");
  }

  const userId = newId("user");
  const orgId = newId("org");
  await db.insert(users).values({
    id: userId,
    authProviderId: `local:${email}`,
    email,
    name: args.name?.trim() || null,
    passwordHash: await hashPassword(args.password)
  });
  await db.insert(organizations).values({
    id: orgId,
    name: args.name ? `${args.name.trim()}'s Studio` : "My Studio",
    slug: orgId.replace("org_", "")
  });
  await db.insert(memberships).values({ id: newId("mem"), orgId, userId, role: "owner" });
  await appendLedgerEntry(db, {
    orgId,
    entryType: "grant",
    amount: STARTER_CREDITS,
    reason: "Starter credits on signup"
  });

  await sendVerificationEmail(userId, email);
  return { userId, orgId };
}

export type SignInResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "locked"; retryAfterSeconds?: number };

/**
 * Verify credentials (FAV-201). Failures are deliberately indistinguishable
 * between "no such user" and "wrong password", and a dummy hash comparison
 * keeps timing similar for unknown addresses.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));

  if (!user?.passwordHash) {
    await verifyPassword(password, "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    return { ok: false, reason: "invalid" };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return {
      ok: false,
      reason: "locked",
      retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000)
    };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const attempts = user.failedLoginAttempts + 1;
    await db
      .update(users)
      .set({
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null,
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id));
    return { ok: false, reason: "invalid" };
  }

  // Success: clear the failure counter, and transparently upgrade the hash if
  // it predates a cost-parameter bump.
  await db
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(password) } : {}),
      updatedAt: new Date()
    })
    .where(eq(users.id, user.id));
  return { ok: true, userId: user.id };
}

/** Password reset request. Always reports success so addresses can't be probed. */
export async function requestPasswordReset(email: string): Promise<void> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!user?.passwordHash) return;

  const token = generateToken();
  await issueAuthToken(db, user.id, "password_reset", token);
  await getEmailProvider().send({
    to: user.email,
    subject: "Reset your FAV Studio password",
    text: `Reset your password here:\n\n${baseUrl()}/reset-password?token=${token}\n\nThis link expires in 1 hour and can be used once. If you didn't request it, ignore this message — your password is unchanged.`
  });
}

/**
 * Provision a user authenticated by an external provider (Clerk/OAuth). They
 * have no local password; identity is asserted upstream.
 */
export async function provisionExternalUser(args: {
  authProviderId: string;
  email: string;
  name?: string;
}): Promise<{ userId: string; orgId: string }> {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.authProviderId, args.authProviderId));
  if (existing) {
    const [membership] = await db.select().from(memberships).where(eq(memberships.userId, existing.id));
    if (membership) return { userId: existing.id, orgId: membership.orgId };
  }

  const userId = existing?.id ?? newId("user");
  const orgId = newId("org");
  if (!existing) {
    await db.insert(users).values({
      id: userId,
      authProviderId: args.authProviderId,
      email: args.email.toLowerCase(),
      name: args.name,
      // Upstream provider already verified the address.
      emailVerifiedAt: new Date()
    });
  }
  await db.insert(organizations).values({
    id: orgId,
    name: args.name ? `${args.name}'s Studio` : "My Studio",
    slug: orgId.replace("org_", "")
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
