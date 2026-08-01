import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, provisionUser, SESSION_COOKIE } from "@/lib/auth";

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80).optional()
});

/**
 * Local signup (FAV-202/1208): creates user + auto-created org + owner role +
 * starter credits, then signs in. With Clerk configured, provisioning instead
 * happens on first authenticated request.
 */
export async function POST(req: NextRequest) {
  if (process.env.CLERK_SECRET_KEY) {
    return NextResponse.json({ error: "Local signup disabled — Clerk is active" }, { status: 400 });
  }
  const parsed = signupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const email = parsed.data.email.toLowerCase();
  const { userId, orgId } = await provisionUser({
    authProviderId: `local:${email}`,
    email,
    name: parsed.data.name
  });

  const res = NextResponse.json({ ok: true, userId, orgId }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 3600,
    path: "/"
  });
  return res;
}
