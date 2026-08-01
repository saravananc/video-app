import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { newId, canInvite } from "@fav/core";
import { getDb, invites } from "@fav/db";
import { authErrorResponse, ForbiddenError, requireSession } from "@/lib/org";

export const dynamic = "force-dynamic";

/** List org invites (admin+). */
export async function GET() {
  try {
    const session = await requireSession();
    if (!canInvite(session.role)) throw new ForbiddenError();
    const rows = await getDb()
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        status: invites.status,
        token: invites.token,
        expiresAt: invites.expiresAt,
        createdAt: invites.createdAt
      })
      .from(invites)
      .where(eq(invites.orgId, session.orgId))
      .orderBy(desc(invites.createdAt));
    return NextResponse.json({ invites: rows });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member")
});

/**
 * Invite a teammate by email (FAV-205): expiring tokenized link. In dev the
 * link is returned/shown directly; production wires an email provider.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (!canInvite(session.role)) throw new ForbiddenError("Only admins and owners can invite");
    const parsed = inviteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const token = randomBytes(24).toString("base64url");
    const db = getDb();
    await db.insert(invites).values({
      id: newId("inv"),
      orgId: session.orgId,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      token,
      invitedByUserId: session.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000)
    });
    const baseUrl = process.env.FAV_BASE_URL ?? req.nextUrl.origin;
    return NextResponse.json({ inviteUrl: `${baseUrl}/invite/${token}` }, { status: 201 });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
