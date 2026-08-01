import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { consumeAuthToken, getDb, users } from "@fav/db";
import { getRateLimiter, hashPassword, validatePassword } from "@fav/providers";
import { requestPasswordReset } from "@/lib/auth";

const requestSchema = z.object({ email: z.string().email().max(200) });

/**
 * Request a reset link (FAV-201). Always returns success — a different
 * response for unknown addresses would let anyone enumerate accounts.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await getRateLimiter("password-reset", 5, 15 * 60_000).check(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
    );
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (parsed.success) await requestPasswordReset(parsed.data.email);
  return NextResponse.json({ ok: true });
}

const completeSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(1).max(200)
});

/** Complete a reset with a single-use token. */
export async function PUT(req: NextRequest) {
  const parsed = completeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const policy = validatePassword(parsed.data.password);
  if (!policy.ok) return NextResponse.json({ error: policy.message }, { status: 400 });

  const db = getDb();
  const consumed = await consumeAuthToken(db, "password_reset", parsed.data.token);
  if (!consumed) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      // A successful reset also clears any lockout.
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date()
    })
    .where(eq(users.id, consumed.userId));
  return NextResponse.json({ ok: true });
}
