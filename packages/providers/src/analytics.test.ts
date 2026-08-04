import { afterEach, describe, expect, it, vi } from "vitest";
import { NoopAnalyticsProvider, PostHogAnalyticsProvider, getAnalytics, resetAnalytics } from "./analytics.js";

afterEach(() => {
  resetAnalytics();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("product analytics (FAV-1602)", () => {
  it("falls back to a no-op provider without an API key", () => {
    expect(getAnalytics().name).toBe("noop");
  });

  it("selects PostHog when a key is configured", () => {
    vi.stubEnv("POSTHOG_API_KEY", "phc_test");
    expect(getAnalytics().name).toBe("posthog");
  });

  it("records the funnel events it is given", () => {
    const analytics = new NoopAnalyticsProvider();
    analytics.capture({ distinctId: "user_1", orgId: "org_1", event: "user_signed_up" });
    analytics.capture({
      distinctId: "user_1",
      orgId: "org_1",
      event: "video_generation_completed",
      properties: { credits: 12 }
    });

    expect(analytics.captured.map((c) => c.event)).toEqual(["user_signed_up", "video_generation_completed"]);
    expect(analytics.captured[1]!.properties).toEqual({ credits: 12 });
  });

  it("batches events into a single request and tags the org group", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const analytics = new PostHogAnalyticsProvider("phc_test", "https://posthog.test");

    for (let i = 0; i < 5; i++) {
      analytics.capture({ distinctId: `user_${i}`, orgId: "org_1", event: "video_generation_started" });
    }
    await analytics.shutdown();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.api_key).toBe("phc_test");
    expect(body.batch).toHaveLength(5);
    expect(body.batch[0].properties.$groups).toEqual({ organization: "org_1" });
  });

  it("never throws when the analytics backend is down", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network unreachable"));
    const analytics = new PostHogAnalyticsProvider("phc_test", "https://posthog.test");
    analytics.capture({ distinctId: "user_1", event: "video_downloaded" });
    // Losing analytics must never surface as a failed user request.
    await expect(analytics.shutdown()).resolves.toBeUndefined();
  });
});
