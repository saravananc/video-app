import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAnalytics, getRateLimiter } from "@fav/providers";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE, signUp, SignupError } from "@/lib/auth";

const signupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  name: z.string().min(1).max(80).optional()
});

/** Create an account (FAV-201/202/1208). */
export async function POST(req: NextRequest) {
  if (process.env.CLERK_SECRET_KEY) {
    return NextResponse.json({ error: "Local signup disabled — Clerk is active" }, { status: 400 });
  }

  // Per-IP throttle so signup can't be used to mass-create orgs or spam email.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await getRateLimiter("signup", 5, 15 * 60_000).check(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many signups from this address. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
    );
  }

  const parsed = signupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address and password." }, { status: 400 });
  }

  try {
    const { userId, orgId } = await signUp(parsed.data);
    // Funnel entry point (FAV-1602): signup -> first video.
    getAnalytics().capture({ distinctId: userId, orgId, event: "user_signed_up" });
    const res = NextResponse.json({ ok: true, userId, orgId, verificationRequired: true }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, createSessionToken(userId), sessionCookieOptions);
    return res;
  } catch (err) {
    if (err instanceof SignupError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
