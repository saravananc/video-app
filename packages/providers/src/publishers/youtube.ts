import type { OAuthTokens, PublisherProvider, PublishMetadata } from "./types.js";
import { ReauthRequiredError, TransientPublishError } from "./types.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

/** Real YouTube adapter (FAV-1301/1302): OAuth consent, refresh, resumable upload. */
export class YouTubePublisherProvider implements PublisherProvider {
  readonly platform = "youtube" as const;
  readonly name = "youtube";

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  getAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  private async tokenRequest(form: Record<string, string>): Promise<OAuthTokens> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...form })
    });
    if (res.status === 400 || res.status === 401) {
      throw new ReauthRequiredError(`Google token endpoint: ${await res.text()}`);
    }
    if (!res.ok) throw new TransientPublishError(`Google token HTTP ${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      scopes: body.scope?.split(" ") ?? SCOPES
    };
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }) {
    const tokens = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    });
    const channelRes = await fetch(CHANNEL_URL, {
      headers: { authorization: `Bearer ${tokens.accessToken}` }
    });
    if (!channelRes.ok) throw new TransientPublishError(`YouTube channels HTTP ${channelRes.status}`);
    const channels = (await channelRes.json()) as {
      items?: Array<{ id: string; snippet: { title: string } }>;
    };
    const channel = channels.items?.[0];
    if (!channel) throw new Error("No YouTube channel on this Google account");
    return { tokens, externalAccountId: channel.id, displayName: channel.snippet.title };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const refreshed = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    return { ...refreshed, refreshToken: refreshed.refreshToken ?? refreshToken };
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
    // Resumable upload: initiate, then PUT the bytes (FAV-1302 AC).
    const initRes = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        snippet: {
          title: metadata.title.slice(0, 100),
          description: metadata.description ?? "",
          tags: metadata.tags ?? []
        },
        status: {
          privacyStatus: metadata.visibility,
          selfDeclaredMadeForKids: false,
          // AI-disclosure metadata (FAV-1607).
          containsSyntheticMedia: metadata.aiDisclosure
        }
      })
    });
    if (initRes.status === 401) throw new ReauthRequiredError();
    if (initRes.status === 429 || initRes.status >= 500) {
      throw new TransientPublishError(`YouTube init HTTP ${initRes.status}`);
    }
    if (!initRes.ok) throw new Error(`YouTube init HTTP ${initRes.status}: ${await initRes.text()}`);
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube resumable upload returned no location");

    const data = await videoData();
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": "video/mp4", "content-length": String(data.length) },
      body: new Uint8Array(data)
    });
    if (uploadRes.status === 429 || uploadRes.status >= 500) {
      throw new TransientPublishError(`YouTube upload HTTP ${uploadRes.status}`);
    }
    if (!uploadRes.ok) throw new Error(`YouTube upload HTTP ${uploadRes.status}: ${await uploadRes.text()}`);
    const body = (await uploadRes.json()) as { id: string };
    return { externalPostId: body.id };
  }
}
