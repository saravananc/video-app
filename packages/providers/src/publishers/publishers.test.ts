import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TikTokPublisherProvider } from "./tiktok.js";
import { YouTubePublisherProvider } from "./youtube.js";
import { MockPublisherProvider } from "./mock.js";
import { ReauthRequiredError, TransientPublishError, type OAuthTokens } from "./types.js";

/**
 * Contract tests for the real publisher adapters (FAV-1302/1303/1304).
 *
 * These adapters were written from API docs and can't be pointed at live
 * accounts here, so they run against a local server that mimics each
 * platform's documented shapes. That verifies the parts that are actually
 * ours — request construction, the two-phase upload sequences, and how error
 * statuses map onto retryable vs re-auth failures — rather than pretending to
 * validate the vendors' behaviour.
 */

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: string;
}

let server: Server;
let baseUrl: string;
const requests: RecordedRequest[] = [];
/** Per-path responses the current test wants the fake platform to return. */
let routes = new Map<string, { status: number; body: unknown; headers?: Record<string, string> }>();

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers as Record<string, string | undefined>,
        body
      });
      const route = routes.get(`${req.method} ${req.url?.split("?")[0]}`);
      if (!route) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no route configured" }));
        return;
      }
      res.writeHead(route.status, { "content-type": "application/json", ...(route.headers ?? {}) });
      res.end(typeof route.body === "string" ? route.body : JSON.stringify(route.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests.length = 0;
  routes = new Map();
});

const TOKENS: OAuthTokens = {
  accessToken: "access-token-123",
  refreshToken: "refresh-token-123",
  expiresAt: Date.now() + 3600_000,
  scopes: ["video.publish"]
};

describe("OAuth URL construction", () => {
  it("YouTube requests offline access so a refresh token is issued", () => {
    const url = new URL(
      new YouTubePublisherProvider("client-id", "client-secret").getAuthUrl({
        redirectUri: "https://app.test/cb",
        state: "state-123"
      })
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("state-123");
    // Without offline access there's no refresh token and publishing breaks
    // an hour later.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("youtube.upload");
  });

  it("TikTok passes client_key and the publish scope", () => {
    const url = new URL(
      new TikTokPublisherProvider("client-key", "client-secret").getAuthUrl({
        redirectUri: "https://app.test/cb",
        state: "state-456"
      })
    );
    expect(url.searchParams.get("client_key")).toBe("client-key");
    expect(url.searchParams.get("scope")).toContain("video.publish");
    expect(url.searchParams.get("state")).toBe("state-456");
  });
});

describe("TikTok Content Posting API (FAV-1303)", () => {
  class TestTikTok extends TikTokPublisherProvider {
    // Point the adapter's endpoints at the local fake.
    protected override initUrl = `${baseUrl}/v2/post/publish/video/init/`;
  }

  it("performs the documented two-phase upload and records the post id", async () => {
    routes.set("POST /v2/post/publish/video/init/", {
      status: 200,
      body: { data: { publish_id: "publish-abc", upload_url: `${baseUrl}/upload/abc` } }
    });
    routes.set("PUT /upload/abc", { status: 200, body: {} });

    const provider = new TestTikTok("client-key", "client-secret");
    const result = await provider.upload({
      tokens: TOKENS,
      videoData: async () => Buffer.alloc(2048, 1),
      metadata: { title: "My video", visibility: "public", aiDisclosure: true }
    });

    expect(result.externalPostId).toBe("publish-abc");

    const init = JSON.parse(requests[0]!.body);
    expect(requests[0]!.headers.authorization).toBe(`Bearer ${TOKENS.accessToken}`);
    expect(init.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    // AI-generated disclosure must travel with the post (FAV-1607).
    expect(init.post_info.is_aigc).toBe(true);
    // Size declaration has to match the bytes actually sent or TikTok rejects it.
    expect(init.source_info.video_size).toBe(2048);
    expect(init.source_info.total_chunk_count).toBe(1);

    expect(requests[1]!.method).toBe("PUT");
    expect(requests[1]!.headers["content-range"]).toBe("bytes 0-2047/2048");
  });

  it("maps private visibility onto SELF_ONLY", async () => {
    routes.set("POST /v2/post/publish/video/init/", {
      status: 200,
      body: { data: { publish_id: "p1", upload_url: `${baseUrl}/upload/abc` } }
    });
    routes.set("PUT /upload/abc", { status: 200, body: {} });

    await new TestTikTok("k", "s").upload({
      tokens: TOKENS,
      videoData: async () => Buffer.alloc(10),
      metadata: { title: "t", visibility: "private", aiDisclosure: false }
    });
    expect(JSON.parse(requests[0]!.body).post_info.privacy_level).toBe("SELF_ONLY");
  });

  it("treats 401 as re-auth and 429/5xx as retryable", async () => {
    const provider = new TestTikTok("k", "s");
    const upload = () =>
      provider.upload({
        tokens: TOKENS,
        videoData: async () => Buffer.alloc(10),
        metadata: { title: "t", visibility: "public", aiDisclosure: true }
      });

    routes.set("POST /v2/post/publish/video/init/", { status: 401, body: { error: "unauthorized" } });
    await expect(upload()).rejects.toThrow(ReauthRequiredError);

    routes.set("POST /v2/post/publish/video/init/", { status: 429, body: { error: "rate limited" } });
    await expect(upload()).rejects.toThrow(TransientPublishError);

    routes.set("POST /v2/post/publish/video/init/", { status: 503, body: { error: "unavailable" } });
    await expect(upload()).rejects.toThrow(TransientPublishError);
  });
});

describe("mock publisher parity", () => {
  it("exposes the same contract the real adapters do", async () => {
    const mock = new MockPublisherProvider("tiktok", "http://app.test");
    const { tokens, externalAccountId } = await mock.exchangeCode({
      code: "mockcode_abc",
      redirectUri: "http://app.test/cb"
    });
    expect(tokens.accessToken).toBeTruthy();
    expect(externalAccountId).toContain("tiktok");

    const refreshed = await mock.refreshTokens(tokens.refreshToken!);
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
    await expect(mock.refreshTokens("not-a-mock-token")).rejects.toThrow(ReauthRequiredError);

    const published = await mock.upload({
      tokens,
      videoData: async () => Buffer.alloc(4),
      metadata: { title: "t", visibility: "public", aiDisclosure: true }
    });
    expect(published.externalPostId).toMatch(/^tiktok_post_/);
  });
});
