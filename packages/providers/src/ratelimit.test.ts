import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { MemoryRateLimiter, RedisRateLimiter, resetRateLimiters } from "./ratelimit.js";

describe("MemoryRateLimiter", () => {
  it("allows up to the limit then blocks with retry-after", async () => {
    const limiter = new MemoryRateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect((await limiter.check("org1")).allowed).toBe(true);
    }
    const blocked = await limiter.check("org1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("scopes windows per key", async () => {
    const limiter = new MemoryRateLimiter(1, 60_000);
    expect((await limiter.check("orgA")).allowed).toBe(true);
    expect((await limiter.check("orgA")).allowed).toBe(false);
    expect((await limiter.check("orgB")).allowed).toBe(true);
  });

  it("frees capacity once the window passes", async () => {
    const limiter = new MemoryRateLimiter(1, 60);
    expect((await limiter.check("org1")).allowed).toBe(true);
    expect((await limiter.check("org1")).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect((await limiter.check("org1")).allowed).toBe(true);
  });
});

// Exercised against a real Redis when one is reachable; skipped otherwise so
// the suite stays runnable without external services.
const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
let redisAvailable = false;
let redis: Redis | null = null;

try {
  redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  await redis.connect();
  await redis.ping();
  redisAvailable = true;
} catch {
  redisAvailable = false;
  await redis?.quit().catch(() => undefined);
  redis = null;
}

describe.skipIf(!redisAvailable)("RedisRateLimiter (FAV-1604)", () => {
  beforeEach(async () => {
    const keys = await redis!.keys("ratelimit:test*");
    if (keys.length > 0) await redis!.del(...keys);
    resetRateLimiters();
  });

  afterAll(async () => {
    await redis?.quit().catch(() => undefined);
  });

  it("allows up to the limit then blocks with retry-after", async () => {
    const limiter = new RedisRateLimiter(redis!, "test-basic", 3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect((await limiter.check("org1")).allowed).toBe(true);
    }
    const blocked = await limiter.check("org1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("shares the window across instances — the whole point of Redis", async () => {
    // Two limiters standing in for two web nodes hitting the same Redis.
    const nodeA = new RedisRateLimiter(redis!, "test-shared", 3, 60_000);
    const nodeB = new RedisRateLimiter(redis!, "test-shared", 3, 60_000);

    expect((await nodeA.check("org1")).allowed).toBe(true);
    expect((await nodeB.check("org1")).allowed).toBe(true);
    expect((await nodeA.check("org1")).allowed).toBe(true);
    // Fourth request overall is refused regardless of which node serves it.
    expect((await nodeB.check("org1")).allowed).toBe(false);
  });

  it("is atomic under concurrency: exactly `limit` requests pass", async () => {
    const limiter = new RedisRateLimiter(redis!, "test-race", 5, 60_000);
    const results = await Promise.all(Array.from({ length: 40 }, () => limiter.check("org1")));
    expect(results.filter((r) => r.allowed).length).toBe(5);
  });

  it("scopes windows per key and per policy", async () => {
    const a = new RedisRateLimiter(redis!, "test-scope-a", 1, 60_000);
    const b = new RedisRateLimiter(redis!, "test-scope-b", 1, 60_000);
    expect((await a.check("org1")).allowed).toBe(true);
    expect((await a.check("org1")).allowed).toBe(false);
    // Different org, same policy.
    expect((await a.check("org2")).allowed).toBe(true);
    // Same org, different policy.
    expect((await b.check("org1")).allowed).toBe(true);
  });

  it("frees capacity once the window slides", async () => {
    const limiter = new RedisRateLimiter(redis!, "test-window", 2, 300);
    expect((await limiter.check("org1")).allowed).toBe(true);
    expect((await limiter.check("org1")).allowed).toBe(true);
    expect((await limiter.check("org1")).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 350));
    expect((await limiter.check("org1")).allowed).toBe(true);
  });

  it("fails open when Redis is unreachable", async () => {
    const dead = new Redis("redis://127.0.0.1:6999", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null
    });
    const limiter = new RedisRateLimiter(dead, "test-dead", 1, 60_000);
    // An outage must not block generation; it allows and logs instead.
    expect((await limiter.check("org1")).allowed).toBe(true);
    expect((await limiter.check("org1")).allowed).toBe(true);
    dead.disconnect();
  });
});
