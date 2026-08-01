import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { newId } from "@fav/core";
import { getDb, socialAccounts } from "@fav/db";
import { encryptSecret, getPublisherProvider, type Platform } from "@fav/providers";
import { requireBillingAccess } from "@/lib/org";

const PLATFORMS = new Set(["youtube", "tiktok", "instagram"]);

/** OAuth callback: exchange the code, store tokens encrypted at rest (FAV-1301/1603). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  if (!PLATFORMS.has(platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 404 });

  let session;
  try {
    session = await requireBillingAccess();
  } catch {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const baseUrl = process.env.FAV_BASE_URL ?? req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(`fav_oauth_state_${platform}`)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${baseUrl}/dashboard/social?error=oauth_state`);
  }

  const publisher = getPublisherProvider(platform as Platform);
  const { tokens, externalAccountId, displayName } = await publisher.exchangeCode({
    code,
    redirectUri: `${baseUrl}/api/social/callback/${platform}`
  });

  const db = getDb();
  const existing = await db
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.orgId, session.orgId),
        eq(socialAccounts.platform, platform as Platform),
        eq(socialAccounts.externalAccountId, externalAccountId)
      )
    );

  const values = {
    displayName,
    accessTokenEncrypted: encryptSecret(tokens.accessToken),
    refreshTokenEncrypted: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    tokenExpiresAt: new Date(tokens.expiresAt),
    scopes: tokens.scopes,
    status: "connected" as const,
    connectedByUserId: session.userId,
    updatedAt: new Date()
  };

  if (existing[0]) {
    await db.update(socialAccounts).set(values).where(eq(socialAccounts.id, existing[0].id));
  } else {
    await db.insert(socialAccounts).values({
      id: newId("soc"),
      orgId: session.orgId,
      platform: platform as Platform,
      externalAccountId,
      ...values
    });
  }

  const res = NextResponse.redirect(`${baseUrl}/dashboard/social?connected=${platform}`);
  res.cookies.set(`fav_oauth_state_${platform}`, "", { maxAge: 0, path: "/" });
  return res;
}
