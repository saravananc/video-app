import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRateLimiter } from "@fav/providers";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE, sessionForUser, signIn } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200)
});

/** Sign in with email + password (FAV-201). */
export async function POST(req: NextRequest) {
  if (process.env.CLERK_SECRET_KEY) {
    return NextResponse.json({ error: "Local login disabled — Clerk is active" }, { status: 400 });
  }

  // Throttle per IP on top of the per-account lockout, so an attacker can't
  // spread guesses thinly across many accounts.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await getRateLimiter("login", 20, 15 * 60_000).check(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
    );
  }

  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const result = await signIn(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    if (result.reason === "locked") {
      return NextResponse.json(
        { error: "Too many failed attempts. This account is temporarily locked." },
        { status: 429, headers: { "retry-after": String(result.retryAfterSeconds ?? 900) } }
      );
    }
    // Same message for unknown address and wrong password.
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const session = await sessionForUser(result.userId);
  if (!session) return NextResponse.json({ error: "No organization for this account." }, { status: 403 });

  const res = NextResponse.json({ ok: true, orgId: session.orgId, role: session.role });
  res.cookies.set(SESSION_COOKIE, createSessionToken(result.userId), sessionCookieOptions);
  return res;
}
