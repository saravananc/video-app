import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { newId } from "@fav/core";
import { getDb, invites, memberships } from "@fav/db";
import { authErrorResponse, requireSession } from "@/lib/org";

const acceptSchema = z.object({ token: z.string().min(10) });

/** Accept an invite: the signed-in user joins the inviting org (FAV-205). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = acceptSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const db = getDb();
    const [invite] = await db.select().from(invites).where(eq(invites.token, parsed.data.token));
    if (!invite || invite.status !== "pending") {
      return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      await db.update(invites).set({ status: "expired" }).where(eq(invites.id, invite.id));
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }

    const [existing] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, invite.orgId), eq(memberships.userId, session.userId)));
    if (!existing) {
      await db.insert(memberships).values({
        id: newId("mem"),
        orgId: invite.orgId,
        userId: session.userId,
        role: invite.role
      });
    }
    await db
      .update(invites)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(invites.id, invite.id));
    return NextResponse.json({ ok: true, orgId: invite.orgId });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
