import { NextRequest, NextResponse } from "next/server";
import { visualStyleSchema } from "@fav/core";
import { MockVisualsProvider } from "@fav/providers";

export const dynamic = "force-dynamic";

/**
 * Visual style preview thumbnails (FAV-506 AC).
 *
 * Rendered by the same mock visuals provider the pipeline uses, so a preview
 * always reflects that style's actual palette and treatment rather than a
 * hand-drawn swatch that can drift out of sync.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ style: string }> }) {
  const { style } = await ctx.params;
  const parsed = visualStyleSchema.safeParse(style);
  if (!parsed.success) return NextResponse.json({ error: "Unknown style" }, { status: 404 });

  const image = await new MockVisualsProvider().generateImage({
    prompt: `${parsed.data} style preview`,
    style: parsed.data,
    tier: "basic",
    aspectRatio: "9:16",
    resolution: "1080p",
    seed: 7
  });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "content-type": image.contentType,
      // Deterministic for a given style, so it caches hard.
      "cache-control": "public, max-age=86400, immutable"
    }
  });
}
