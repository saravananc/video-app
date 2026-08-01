import { Redis } from "ioredis";

/**
 * Rate limiting (FAV-1604/104). The limiter is a sliding window keyed per org.
 *
 * The in-memory implementation is per-process: with more than one web instance
 * the effective limit multiplies by the instance count, and every deploy resets
 * it. Production must set REDIS_URL so the window is shared across the fleet.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  readonly name: string;
  check(key: string): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  readonly name = "memory";
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= this.limit) {
      const oldest = timestamps[0]!;
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000))
      };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, remaining: this.limit - timestamps.length, retryAfterSeconds: 0 };
  }
}

/**
 * Sliding window over a Redis sorted set, evaluated atomically in Lua so
 * concurrent requests across instances can't both pass a stale count.
 * Members are `<timestamp>-<random>` to keep same-millisecond requests distinct.
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retryMs = window
if oldest[2] then
  retryMs = (tonumber(oldest[2]) + window) - now
end
redis.call('PEXPIRE', key, window)
return {0, 0, retryMs}
`;

export class RedisRateLimiter implements RateLimiter {
  readonly name = "redis";

  constructor(
    private readonly redis: Redis,
    private readonly policy: string,
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const member = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const [allowed, remaining, retryMs] = (await this.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `ratelimit:${this.policy}:${key}`,
        String(Date.now()),
        String(this.windowMs),
        String(this.limit),
        member
      )) as [number, number, number];
      return {
        allowed: allowed === 1,
        remaining,
        retryAfterSeconds: allowed === 1 ? 0 : Math.max(1, Math.ceil(retryMs / 1000))
      };
    } catch (err) {
      // Fail open: a Redis outage must not take generation down with it. The
      // request is allowed and the failure is logged for alerting (FAV-1608).
      console.error(JSON.stringify({ event: "ratelimit_backend_error", policy: this.policy, error: String(err) }));
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    }
  }
}

let redisClient: Redis | null = null;
let redisUnavailable = false;

/** Lazily-built shared Redis connection; null when REDIS_URL isn't configured. */
export function getRedis(): Redis | null {
  if (redisUnavailable) return null;
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) {
    redisUnavailable = true;
    return null;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false
  });
  client.on("error", (err: Error) => {
    console.error(JSON.stringify({ event: "redis_error", error: err.message }));
  });
  redisClient = client;
  return client;
}

const limiters = new Map<string, RateLimiter>();

/**
 * Shared limiter registry so route handlers get a stable instance per policy.
 * Redis-backed when REDIS_URL is set, in-memory otherwise (dev/single-node).
 */
export function getRateLimiter(policy: string, limit: number, windowMs: number): RateLimiter {
  const cacheKey = `${policy}:${limit}:${windowMs}`;
  let limiter = limiters.get(cacheKey);
  if (!limiter) {
    const redis = getRedis();
    limiter = redis
      ? new RedisRateLimiter(redis, policy, limit, windowMs)
      : new MemoryRateLimiter(limit, windowMs);
    limiters.set(cacheKey, limiter);
  }
  return limiter;
}

/** Test hook. */
export function resetRateLimiters(): void {
  limiters.clear();
  redisClient = null;
  redisUnavailable = false;
}
