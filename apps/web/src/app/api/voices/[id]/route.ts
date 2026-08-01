import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, users, voices } from "@fav/db";
import { decryptSecret, getStorageProvider } from "@fav/providers";
import { authErrorResponse, requireSession, requireVideoAccess } from "@/lib/org";

/** Delete an org voice clone (FAV-1106 manage clones). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireVideoAccess();
    const { id } = await ctx.params;
    const db = getDb();
    const [voice] = await db
      .select()
      .from(voices)
      .where(and(eq(voices.id, id), eq(voices.orgId, session.orgId)));
    if (!voice) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (voice.cloneSampleKeyEncrypted) {
      await getStorageProvider()
        .delete(decryptSecret(voice.cloneSampleKeyEncrypted))
        .catch(() => undefined);
    }
    await db.delete(voices).where(eq(voices.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

/** Set as my default voice (FAV-1106). */
export async function PUT(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await ctx.params;
    const db = getDb();
    await db.update(users).set({ defaultVoiceId: id, updatedAt: new Date() }).where(eq(users.id, session.userId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
