import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetJwksCache, verifyClerkSessionToken } from "./clerk-jwt";

/**
 * Verified against a real RSA key pair generated here, so these exercise the
 * actual RS256 signature path rather than a stubbed verifier.
 */
let privateKey: KeyObject;
let jwk: Record<string, unknown>;
/** A second key, published only after rotation, to exercise the refetch path. */
let rotatedPrivateKey: KeyObject;
let rotatedJwk: Record<string, unknown>;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "test-key-1", alg: "RS256" };

  const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
  rotatedPrivateKey = rotated.privateKey;
  rotatedJwk = { ...rotated.publicKey.export({ format: "jwk" }), kid: "rotated-key", alg: "RS256" };
});

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeToken(
  claims: Record<string, unknown>,
  opts: { alg?: string; kid?: string; key?: KeyObject } = {}
): string {
  const header = b64url(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "test-key-1", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = b64url(signer.sign(opts.key ?? privateKey));
  return `${header}.${payload}.${signature}`;
}

function validClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { sub: "user_clerk_123", iat: now, exp: now + 3600, iss: "https://clerk.test", ...overrides };
}

beforeEach(() => {
  resetJwksCache();
  vi.stubEnv("CLERK_JWKS_URL", "https://clerk.test/.well-known/jwks.json");
  // A fresh Response per call — a shared one can only have its body read once,
  // which would mask whether a refetch actually reparsed the key set.
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Clerk session verification (FAV-201)", () => {
  it("accepts a correctly signed, unexpired token", async () => {
    const claims = await verifyClerkSessionToken(makeToken(validClaims()));
    expect(claims?.sub).toBe("user_clerk_123");
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await verifyClerkSessionToken(makeToken(validClaims({ exp: now - 3600 })))).toBeNull();
  });

  it("rejects a not-yet-valid token", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await verifyClerkSessionToken(makeToken(validClaims({ nbf: now + 3600 })))).toBeNull();
  });

  it("rejects a token signed by a different key", async () => {
    const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forged = makeToken(validClaims(), { key: attacker.privateKey });
    expect(await verifyClerkSessionToken(forged)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = makeToken(validClaims());
    const [header, , signature] = token.split(".");
    const swapped = b64url(JSON.stringify(validClaims({ sub: "user_someone_else" })));
    expect(await verifyClerkSessionToken(`${header}.${swapped}.${signature}`)).toBeNull();
  });

  it('rejects alg "none" and other algorithms', async () => {
    // The classic JWT bypass: claim no signature is needed.
    const header = b64url(JSON.stringify({ alg: "none", kid: "test-key-1", typ: "JWT" }));
    const payload = b64url(JSON.stringify(validClaims()));
    expect(await verifyClerkSessionToken(`${header}.${payload}.`)).toBeNull();
    expect(await verifyClerkSessionToken(makeToken(validClaims(), { alg: "HS256" }))).toBeNull();
  });

  it("rejects a token whose issuer doesn't match", async () => {
    vi.stubEnv("CLERK_ISSUER", "https://clerk.test");
    expect(await verifyClerkSessionToken(makeToken(validClaims({ iss: "https://evil.test" })))).toBeNull();
  });

  it("rejects malformed tokens without throwing", async () => {
    for (const bad of ["", "not-a-jwt", "a.b", "a.b.c.d"]) {
      expect(await verifyClerkSessionToken(bad)).toBeNull();
    }
  });

  it("rejects a token with no subject", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await verifyClerkSessionToken(makeToken({ exp: now + 3600 }))).toBeNull();
  });

  it("caches JWKS instead of refetching per request", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await verifyClerkSessionToken(makeToken(validClaims()));
    await verifyClerkSessionToken(makeToken(validClaims()));
    await verifyClerkSessionToken(makeToken(validClaims()));
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("refetches on an unknown key id and accepts the rotated key", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    // Warm the cache with the old key set.
    await verifyClerkSessionToken(makeToken(validClaims()));
    expect(fetchMock.mock.calls.length).toBe(1);

    // Clerk rotates: the new key is published, and a token arrives signed by it.
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ keys: [jwk, rotatedJwk] }), { status: 200 })
    );
    const claims = await verifyClerkSessionToken(
      makeToken(validClaims(), { kid: "rotated-key", key: rotatedPrivateKey })
    );
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(claims?.sub).toBe("user_clerk_123");
  });

  it("gives up after one refetch when the key id is simply unknown", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const forged = makeToken(validClaims(), { kid: "never-published", key: rotatedPrivateKey });
    expect(await verifyClerkSessionToken(forged)).toBeNull();
    // Cold cache plus a single rotation refetch — not an unbounded retry loop.
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it("returns null when JWKS is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    resetJwksCache();
    expect(await verifyClerkSessionToken(makeToken(validClaims()))).toBeNull();
  });

  it("returns null when no JWKS URL is configured", async () => {
    vi.unstubAllEnvs();
    resetJwksCache();
    expect(await verifyClerkSessionToken(makeToken(validClaims()))).toBeNull();
  });
});
