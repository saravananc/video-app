import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@fav/core";
import { auditLog, getDb, impersonationSessions } from "@fav/db";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";

const IMPERSONATION_COOKIE = "fav_impersonate";
/** Time-boxed sessions (FAV-1704 AC). */
const IMPERSONATION_TTL_MS = 30 * 60 * 1000;

const startSchema = z.object({
  orgId: z.string(),
  reason: z.string().min(5).max(300)
});

/** Start audited support impersonation of an org (FAV-1704). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireStaff();
    const parsed = startSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input (reason required)" }, { status: 400 });

    const db = getDb();
    const id = newId("imp");
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);
    await db.insert(impersonationSessions).values({
      id,
      staffUserId: session.userId,
      targetOrgId: parsed.data.orgId,
      reason: parsed.data.reason,
      expiresAt
    });
    await db.insert(auditLog).values({
      id: newId("aud"),
      actorUserId: session.userId,
      orgId: parsed.data.orgId,
      action: "impersonation.start",
      targetType: "organization",
      targetId: parsed.data.orgId,
      impersonationSessionId: id,
      metadata: { reason: parsed.data.reason }
    });

    const res = NextResponse.json({ ok: true, impersonationId: id, expiresAt });
    res.cookies.set(IMPERSONATION_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: IMPERSONATION_TTL_MS / 1000,
      path: "/"
    });
    return res;
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

/** End impersonation, closing the audit window. */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireStaff();
    const impersonationId = req.cookies.get(IMPERSONATION_COOKIE)?.value;
    if (impersonationId) {
      const db = getDb();
      await db
        .update(impersonationSessions)
        .set({ endedAt: new Date() })
        .where(eq(impersonationSessions.id, impersonationId));
      await db.insert(auditLog).values({
        id: newId("aud"),
        actorUserId: session.userId,
        action: "impersonation.end",
        impersonationSessionId: impersonationId
      });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(IMPERSONATION_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
