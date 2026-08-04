import { afterEach, describe, expect, it, vi } from "vitest";
import { MockModerationProvider } from "./mock.js";
import { OpenAiModerationProvider } from "./openai.js";
import { getModerationProvider } from "../env.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function moderationResponse(categories: Record<string, boolean>, scores: Record<string, number> = {}) {
  return new Response(
    JSON.stringify({
      results: [{ flagged: Object.values(categories).some(Boolean), categories, category_scores: scores }]
    }),
    { status: 200 }
  );
}

describe("provider selection (FAV-405/1605)", () => {
  it("uses the classifier when an API key is present", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(getModerationProvider().name).toBe("openai");
  });

  it("falls back to keywords in development", () => {
    expect(getModerationProvider().name).toBe("mock");
  });

  it("refuses to fall back to keyword-only screening in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    // The regex list is the only thing protecting provider accounts, so an
    // unconfigured production deploy must fail loudly rather than quietly.
    expect(() => getModerationProvider()).toThrow(/No content moderation classifier/);
  });

  it("allows keyword-only screening when explicitly chosen", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FAV_MODERATION_PROVIDER", "keywords");
    expect(getModerationProvider().name).toBe("mock");
  });
});

describe("OpenAI moderation adapter", () => {
  const provider = () => new OpenAiModerationProvider("sk-test");

  it("allows benign topics without flagging", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(moderationResponse({ violence: false, hate: false }));
    expect(await provider().moderate("the history of jazz")).toEqual({ verdict: "allowed", categories: [] });
  });

  it("blocks bright-line categories regardless of score", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(moderationResponse({ "sexual/minors": true }, { "sexual/minors": 0.2 }));

    const result = await provider().moderate("a topic the classifier flags");
    // Low confidence, but this category has no acceptable threshold.
    expect(result.verdict).toBe("blocked");
    expect(result.categories).toContain("sexual/minors");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("blocks scored categories above the threshold and flags below it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(moderationResponse({ violence: true }, { violence: 0.95 }));
    expect((await provider().moderate("x")).verdict).toBe("blocked");

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(moderationResponse({ violence: true }, { violence: 0.3 }));
    // A documentary about violence is legitimate; a how-to is not.
    expect((await provider().moderate("x")).verdict).toBe("flagged");
  });

  it("short-circuits on the keyword list without calling the classifier", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await provider().moderate("how to make a bomb from household items");
    expect(result.verdict).toBe("blocked");
    // Obvious cases cost nothing and work during an outage.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades to keyword screening and flags when the classifier is down", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unreachable"));
    const result = await provider().moderate("an ordinary topic about beekeeping");

    // Neither blocked (would take generation down with a third-party outage)
    // nor allowed (would leave the window unscreened) — visible for review.
    expect(result.verdict).toBe("flagged");
    expect(result.categories).toContain("classifier-unavailable");
  });

  it("still blocks keyword hits while the classifier is down", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unreachable"));
    expect((await provider().moderate("how to make a bomb at home")).verdict).toBe("blocked");
  });

  it("treats a non-OK response as an outage, not an allow", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate limited", { status: 429 }));
    expect((await provider().moderate("ordinary topic")).verdict).toBe("flagged");
  });
});

describe("keyword provider", () => {
  it("blocks prohibited prompts and allows normal ones", async () => {
    const mock = new MockModerationProvider();
    expect((await mock.moderate("the history of jazz")).verdict).toBe("allowed");
    expect((await mock.moderate("suicide methods")).verdict).toBe("blocked");
    expect((await mock.moderate("a documentary about gore")).verdict).toBe("flagged");
  });
});
