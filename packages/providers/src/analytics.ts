import { logger } from "@fav/core";

/**
 * Product analytics (FAV-1602). Events are fire-and-forget: analytics must
 * never slow a request or fail one. Without POSTHOG_API_KEY this logs instead
 * of sending, so the funnel is still inspectable in development.
 */

/** The signup -> first-video funnel plus the feature-usage events (FAV-1602 AC). */
export type AnalyticsEvent =
  | "user_signed_up"
  | "email_verified"
  | "video_generation_started"
  | "video_generation_completed"
  | "video_generation_failed"
  | "video_downloaded"
  | "video_published"
  | "scene_rerolled"
  | "scene_edited"
  | "voice_cloned"
  | "autopilot_rule_created"
  | "checkout_started"
  | "credits_purchased"
  | "api_key_issued";

export interface AnalyticsProvider {
  readonly name: string;
  capture(args: {
    /** Stable per-user id so a funnel can be followed across sessions. */
    distinctId: string;
    event: AnalyticsEvent;
    properties?: Record<string, unknown>;
    /** Group analytics by org, which is how retention is actually read here. */
    orgId?: string;
  }): void;
  shutdown(): Promise<void>;
}

export class NoopAnalyticsProvider implements AnalyticsProvider {
  readonly name = "noop";
  /** Test hook: everything captured this process. */
  readonly captured: Array<{ event: AnalyticsEvent; distinctId: string; properties?: Record<string, unknown> }> = [];

  capture(args: Parameters<AnalyticsProvider["capture"]>[0]): void {
    this.captured.push({ event: args.event, distinctId: args.distinctId, properties: args.properties });
    logger.debug("analytics_event", { event: args.event, distinctId: args.distinctId, orgId: args.orgId });
  }

  async shutdown(): Promise<void> {}
}

/**
 * PostHog via its capture endpoint — a direct POST rather than the SDK, which
 * keeps the worker and edge runtimes free of a Node-only dependency.
 */
export class PostHogAnalyticsProvider implements AnalyticsProvider {
  readonly name = "posthog";
  private queue: unknown[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com"
  ) {}

  capture(args: Parameters<AnalyticsProvider["capture"]>[0]): void {
    this.queue.push({
      event: args.event,
      distinct_id: args.distinctId,
      properties: {
        ...args.properties,
        ...(args.orgId ? { $groups: { organization: args.orgId } } : {})
      },
      timestamp: new Date().toISOString()
    });
    // Small batch window so a burst of events is one request.
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 2000);
    if (this.queue.length >= 20) void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) return;
    try {
      await fetch(`${this.host}/batch/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: this.apiKey, batch })
      });
    } catch (err) {
      // Losing analytics is acceptable; failing a user request for it is not.
      logger.warn("analytics_flush_failed", { error: String(err), dropped: batch.length });
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
  }
}

let analyticsSingleton: AnalyticsProvider | null = null;

export function getAnalytics(): AnalyticsProvider {
  if (analyticsSingleton) return analyticsSingleton;
  const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  analyticsSingleton = key ? new PostHogAnalyticsProvider(key) : new NoopAnalyticsProvider();
  return analyticsSingleton;
}

/** Test hook. */
export function resetAnalytics(): void {
  analyticsSingleton = null;
}
