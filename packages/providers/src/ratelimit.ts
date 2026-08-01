/**
 * Rate limiting (FAV-1604): sliding-window limiter keyed per org. In-memory in
 * dev/single-node; the same interface backs a Redis implementation in
 * production (REDIS_URL) — swap without touching call sites.
 */

export interface RateLimiter {
  /** Returns allowed=false with retryAfterSeconds when over the limit. */
  check(key: string): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  async check(key: string) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= this.limit) {
      const oldest = timestamps[0]!;
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((oldest + this.windowMs - now) / 1000)
      };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, remaining: this.limit - timestamps.length, retryAfterSeconds: 0 };
  }
}

const limiters = new Map<string, MemoryRateLimiter>();

/** Shared limiter registry so route handlers get a stable instance per policy. */
export function getRateLimiter(policy: string, limit: number, windowMs: number): RateLimiter {
  const key = `${policy}:${limit}:${windowMs}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new MemoryRateLimiter(limit, windowMs);
    limiters.set(key, limiter);
  }
  return limiter;
}
