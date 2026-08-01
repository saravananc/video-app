import { randomBytes } from "node:crypto";
import type { OAuthTokens, Platform, PublisherProvider, PublishMetadata } from "./types.js";
import { ReauthRequiredError } from "./types.js";

/**
 * Mock publisher (dev): the "consent screen" is a local page that immediately
 * redirects back with a code, uploads succeed instantly with a fake post id —
 * so the whole connect -> publish -> track loop is exercisable keyless.
 */
export class MockPublisherProvider implements PublisherProvider {
  readonly name = "mock";

  constructor(
    readonly platform: Platform,
    private readonly baseUrl: string
  ) {}

  getAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
    const params = new URLSearchParams({
      platform: this.platform,
      redirect_uri: redirectUri,
      state,
      code: `mockcode_${randomBytes(8).toString("hex")}`
    });
    return `${this.baseUrl}/social/mock-consent?${params.toString()}`;
  }

  async exchangeCode({ code }: { code: string; redirectUri: string }) {
    if (!code.startsWith("mockcode_")) throw new Error("Bad mock code");
    return {
      tokens: {
        accessToken: `mock_access_${randomBytes(12).toString("hex")}`,
        refreshToken: `mock_refresh_${randomBytes(12).toString("hex")}`,
        expiresAt: Date.now() + 3600_000,
        scopes: [`${this.platform}.upload`]
      },
      externalAccountId: `${this.platform}_acct_demo`,
      displayName: `Demo ${this.platform[0]!.toUpperCase()}${this.platform.slice(1)} Channel`
    };
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    if (!refreshToken.startsWith("mock_refresh_")) throw new ReauthRequiredError();
    return {
      accessToken: `mock_access_${randomBytes(12).toString("hex")}`,
      refreshToken,
      expiresAt: Date.now() + 3600_000,
      scopes: [`${this.platform}.upload`]
    };
  }

  async upload({ metadata }: { tokens: OAuthTokens; videoData: () => Promise<Buffer>; metadata: PublishMetadata }) {
    void metadata;
    return { externalPostId: `${this.platform}_post_${randomBytes(6).toString("hex")}` };
  }
}
