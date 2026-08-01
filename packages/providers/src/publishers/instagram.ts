import type { OAuthTokens, PublisherProvider, PublishMetadata } from "./types.js";
import { ReauthRequiredError, TransientPublishError } from "./types.js";

const GRAPH = "https://graph.facebook.com/v21.0";
const AUTH_URL = "https://www.facebook.com/v21.0/dialog/oauth";
const SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list"];

/**
 * Real Instagram Reels adapter via the Graph API container->publish flow
 * (FAV-1304). Requires a Business/Creator account linked to a Facebook Page;
 * the video must be reachable by URL (we pass a signed storage URL).
 */
export class InstagramPublisherProvider implements PublisherProvider {
  readonly platform = "instagram" as const;
  readonly name = "instagram";

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    /** Signed public URL builder for the final MP4 — Graph pulls by URL. */
    private readonly videoUrlFor?: (data: Buffer) => Promise<string>
  ) {}

  getAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      state
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }) {
    const res = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${this.appId}&client_secret=${this.appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`
    );
    if (!res.ok) throw new ReauthRequiredError(`Instagram OAuth HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };

    // Resolve the IG Business account behind the user's first Page.
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${body.access_token}`);
    if (!pagesRes.ok) throw new TransientPublishError(`Instagram pages HTTP ${pagesRes.status}`);
    const pages = (await pagesRes.json()) as { data: Array<{ id: string; name: string }> };
    const page = pages.data[0];
    if (!page) throw new Error("No Facebook Page found — Instagram Business account required");
    const igRes = await fetch(
      `${GRAPH}/${page.id}?fields=instagram_business_account{id,name}&access_token=${body.access_token}`
    );
    const ig = (await igRes.json()) as { instagram_business_account?: { id: string; name?: string } };
    if (!ig.instagram_business_account) {
      throw new Error("Page has no linked Instagram Business/Creator account");
    }

    return {
      tokens: {
        accessToken: body.access_token,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
        scopes: SCOPES
      },
      externalAccountId: ig.instagram_business_account.id,
      displayName: ig.instagram_business_account.name ?? page.name
    };
  }

  async refreshTokens(): Promise<OAuthTokens> {
    // Long-lived FB tokens are exchanged, not refreshed; force reconnect when stale.
    throw new ReauthRequiredError("Instagram tokens must be re-issued via reconnect");
  }

  async upload({
    tokens,
    videoData,
    metadata
  }: {
    tokens: OAuthTokens;
    videoData: () => Promise<Buffer>;
    metadata: PublishMetadata;
  }) {
    if (!this.videoUrlFor) throw new Error("Instagram publishing requires a public video URL provider");
    const videoUrl = await this.videoUrlFor(await videoData());
    // Account id travels in scopes metadata; the publish flow re-reads it.
    const igUserId = tokens.scopes.find((s) => s.startsWith("ig:"))?.slice(3);
    if (!igUserId) throw new Error("Missing Instagram account id in token scopes");

    // Two-step publish (FAV-1304 AC): create container, then publish it.
    const containerRes = await fetch(`${GRAPH}/${igUserId}/media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: videoUrl,
        caption: metadata.title,
        access_token: tokens.accessToken
      })
    });
    if (containerRes.status === 429 || containerRes.status >= 500) {
      throw new TransientPublishError(`Instagram container HTTP ${containerRes.status}`);
    }
    if (!containerRes.ok) throw new Error(`Instagram container HTTP ${containerRes.status}`);
    const container = (await containerRes.json()) as { id: string };

    const publishRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creation_id: container.id, access_token: tokens.accessToken })
    });
    if (publishRes.status === 429 || publishRes.status >= 500) {
      throw new TransientPublishError(`Instagram publish HTTP ${publishRes.status}`);
    }
    if (!publishRes.ok) throw new Error(`Instagram publish HTTP ${publishRes.status}`);
    const published = (await publishRes.json()) as { id: string };
    return { externalPostId: published.id };
  }
}
