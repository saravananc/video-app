import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, memberships } from "@fav/db";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth";
import { authErrorResponse, requireSession } from "@/lib/org";

const switchSchema = z.object({ orgId: z.string() });

/**
 * Switch the active organization (FAV-202). Membership is re-checked here so
 * setting the cookie by hand can't grant access to someone else's org.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = switchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const [membership] = await getDb()
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, session.userId), eq(memberships.orgId, parsed.data.orgId)));
    if (!membership) return NextResponse.json({ error: "Not a member of that organization" }, { status: 403 });

    const res = NextResponse.json({ ok: true, orgId: parsed.data.orgId });
    res.cookies.set(ACTIVE_ORG_COOKIE, parsed.data.orgId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 3600,
      path: "/"
    });
    return res;
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
