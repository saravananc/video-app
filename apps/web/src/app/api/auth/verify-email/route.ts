import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { consumeAuthToken, getDb, users } from "@fav/db";
import { getSession, sendVerificationEmail } from "@/lib/auth";

const verifySchema = z.object({ token: z.string().min(10).max(200) });

/** Confirm an email address with a single-use token (FAV-201). */
export async function POST(req: NextRequest) {
  const parsed = verifySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid link." }, { status: 400 });

  const consumed = await consumeAuthToken(getDb(), "email_verification", parsed.data.token);
  if (!consumed) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });
  }
  await getDb()
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, consumed.userId));
  return NextResponse.json({ ok: true });
}

/** Resend the verification email to the signed-in user. */
export async function PUT() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.user.emailVerified) return NextResponse.json({ ok: true, alreadyVerified: true });
  await sendVerificationEmail(session.userId, session.user.email);
  return NextResponse.json({ ok: true });
}
