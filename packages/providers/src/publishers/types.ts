/** Social publishing abstraction (FAV-13xx): OAuth + upload per platform. */

export type Platform = "youtube" | "tiktok" | "instagram";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  scopes: string[];
}

export interface PublishMetadata {
  title: string;
  description?: string;
  tags?: string[];
  visibility: "public" | "unlisted" | "private";
  /** Platform AI-disclosure flag (FAV-1607). */
  aiDisclosure: boolean;
}

export class TransientPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientPublishError";
  }
}

export class ReauthRequiredError extends Error {
  constructor(message = "Account needs to be reconnected") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export interface PublisherProvider {
  readonly platform: Platform;
  readonly name: string;
  /** Build the OAuth consent URL (FAV-1301). state carries orgId + CSRF nonce. */
  getAuthUrl(args: { redirectUri: string; state: string }): string;
  exchangeCode(args: { code: string; redirectUri: string }): Promise<{
    tokens: OAuthTokens;
    externalAccountId: string;
    displayName: string;
  }>;
  /** Refresh before expiry (FAV-1305); throws ReauthRequiredError when refresh is dead. */
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  /** Upload the final MP4 (FAV-1302); throws TransientPublishError for retryable failures. */
  upload(args: {
    tokens: OAuthTokens;
    videoData: () => Promise<Buffer>;
    metadata: PublishMetadata;
  }): Promise<{ externalPostId: string }>;
}
