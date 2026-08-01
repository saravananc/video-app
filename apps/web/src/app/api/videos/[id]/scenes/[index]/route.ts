import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, videos } from "@fav/db";
import { applySceneEdit } from "@fav/workflows";
import { authErrorResponse, requireVideoAccess } from "@/lib/org";

const editSchema = z.object({
  narration: z.string().min(1).max(1200).optional(),
  visualPrompt: z.string().min(1).max(1000).optional(),
  onScreenText: z.string().max(120).nullable().optional()
});

/** Inline scene edit (FAV-404/1103): persists and invalidates stale artifacts. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; index: string }> }
) {
  try {
    const { orgId } = await requireVideoAccess();
    const { id, index } = await ctx.params;
    const db = getDb();
    const [video] = await db
      .select({ id: videos.id, status: videos.status })
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.orgId, orgId)));
    if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (video.status === "generating" || video.status === "rendering" || video.status === "queued") {
      return NextResponse.json({ error: "Wait for the current generation to finish" }, { status: 409 });
    }

    const parsed = editSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    await applySceneEdit(db, { videoId: id, sceneIndex: Number(index), ...parsed.data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
