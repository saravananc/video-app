import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getPublisherProvider, type Platform } from "@fav/providers";
import { authErrorResponse, requireBillingAccess } from "@/lib/org";

const PLATFORMS = new Set(["youtube", "tiktok", "instagram"]);

/** Start the OAuth consent flow for a platform (FAV-1301). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  try {
    await requireBillingAccess();
    const { platform } = await ctx.params;
    if (!PLATFORMS.has(platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 404 });

    const baseUrl = process.env.FAV_BASE_URL ?? req.nextUrl.origin;
    const redirectUri = `${baseUrl}/api/social/callback/${platform}`;
    const state = randomBytes(16).toString("hex");
    const publisher = getPublisherProvider(platform as Platform);
    const url = publisher.getAuthUrl({ redirectUri, state });

    const res = NextResponse.redirect(url);
    // CSRF state cookie, verified in the callback.
    res.cookies.set(`fav_oauth_state_${platform}`, state, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/"
    });
    return res;
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
