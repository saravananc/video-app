import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, users } from "@fav/db";
import { createSessionToken, SESSION_COOKIE, sessionForUser } from "@/lib/auth";

/**
 * Local dev login (FAV-201 fallback): sign in as a seeded demo user by email.
 * Disabled automatically when Clerk is configured.
 */
export async function POST(req: NextRequest) {
  if (process.env.CLERK_SECRET_KEY) {
    return NextResponse.json({ error: "Local login disabled — Clerk is active" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  if (!body?.email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase()));
  if (!user || !user.authProviderId.startsWith("local:")) {
    return NextResponse.json({ error: "Unknown user" }, { status: 401 });
  }
  const session = await sessionForUser(user.id);
  if (!session) return NextResponse.json({ error: "No organization for user" }, { status: 401 });

  const res = NextResponse.json({ ok: true, orgId: session.orgId, role: session.role });
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 3600,
    path: "/"
  });
  return res;
}
