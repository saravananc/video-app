import type { OAuthTokens, PublisherProvider, PublishMetadata } from "./types.js";
import { ReauthRequiredError, TransientPublishError } from "./types.js";

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const SCOPES = ["user.info.basic", "video.publish"];

/**
 * Real TikTok adapter via the Content Posting API (FAV-1303). Note: the app
 * must pass TikTok's audit before unrestricted posting — accounts are limited
 * to private visibility until then (the backlog's app-review prep).
 */
export class TikTokPublisherProvider implements PublisherProvider {
  readonly platform = "tiktok" as const;
  readonly name = "tiktok";

  /** Overridable so contract tests can point the adapter at a local fake. */
  protected tokenUrl = "https://open.tiktokapis.com/v2/oauth/token/";
  protected initUrl = "https://open.tiktokapis.com/v2/post/publish/video/init/";

  constructor(
    private readonly clientKey: string,
    private readonly clientSecret: string
  ) {}

  getAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
    const params = new URLSearchParams({
      client_key: this.clientKey,
      response_type: "code",
      scope: SCOPES.join(","),
      redirect_uri: redirectUri,
      state
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  private async tokenRequest(form: Record<string, string>): Promise<OAuthTokens & { openId?: string }> {
    const res = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: this.clientKey,
        client_secret: this.clientSecret,
        ...form
      })
    });
    if (!res.ok) throw new TransientPublishError(`TikTok token HTTP ${res.status}`);
    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
      error?: string;
      error_description?: string;
    };
    if (!body.access_token) {
      throw new ReauthRequiredError(`TikTok: ${body.error_description ?? body.error ?? "no token"}`);
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + (body.expires_in ?? 86400) * 1000,
      scopes: SCOPES,
      openId: body.open_id
    };
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }) {
    const tokens = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    });
    return {
      tokens,
      externalAccountId: tokens.openId ?? "tiktok-user",
      displayName: "TikTok account"
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
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
    const data = await videoData();
    // Two-phase: init declares size/chunks, then PUT the bytes (content rules respected).
    const initRes = await fetch(this.initUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        post_info: {
          title: metadata.title.slice(0, 150),
          privacy_level: metadata.visibility === "public" ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY",
          disable_comment: false,
          // AI-generated content disclosure (FAV-1607).
          is_aigc: metadata.aiDisclosure
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: data.length,
          chunk_size: data.length,
          total_chunk_count: 1
        }
      })
    });
    if (initRes.status === 401) throw new ReauthRequiredError();
    if (initRes.status === 429 || initRes.status >= 500) {
      throw new TransientPublishError(`TikTok init HTTP ${initRes.status}`);
    }
    if (!initRes.ok) throw new Error(`TikTok init HTTP ${initRes.status}: ${await initRes.text()}`);
    const initBody = (await initRes.json()) as {
      data: { publish_id: string; upload_url: string };
    };

    const uploadRes = await fetch(initBody.data.upload_url, {
      method: "PUT",
      headers: {
        "content-type": "video/mp4",
        "content-range": `bytes 0-${data.length - 1}/${data.length}`
      },
      body: new Uint8Array(data)
    });
    if (uploadRes.status === 429 || uploadRes.status >= 500) {
      throw new TransientPublishError(`TikTok upload HTTP ${uploadRes.status}`);
    }
    if (!uploadRes.ok) throw new Error(`TikTok upload HTTP ${uploadRes.status}`);
    return { externalPostId: initBody.data.publish_id };
  }
}
