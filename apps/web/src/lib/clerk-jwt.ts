import { createPublicKey, createVerify } from "node:crypto";
import { logger } from "@fav/core";

/**
 * Clerk session verification (FAV-201).
 *
 * Clerk issues an RS256 JWT in the `__session` cookie. Verifying it locally
 * against the instance JWKS means no network call on the request path, which
 * is why this is done by hand rather than pulling in a JWT library — the
 * codebase already verifies HMAC signatures with node:crypto elsewhere.
 */

export interface ClerkClaims {
  /** Clerk user id. */
  sub: string;
  exp: number;
  nbf?: number;
  iat?: number;
  iss?: string;
  azp?: string;
  sid?: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

/** JWKS changes rarely; refetching per request would add latency for nothing. */
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

function jwksUrl(): string | null {
  const explicit = process.env.CLERK_JWKS_URL;
  if (explicit) return explicit;
  // Derivable from the frontend API host, which the publishable key encodes.
  const issuer = process.env.CLERK_ISSUER;
  return issuer ? `${issuer.replace(/\/$/, "")}/.well-known/jwks.json` : null;
}

async function getJwks(forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const url = jwksUrl();
  if (!url) throw new Error("Clerk JWKS URL not configured — set CLERK_ISSUER or CLERK_JWKS_URL");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Clerk JWKS HTTP ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Build a verifiable public key from the JWK's RSA modulus and exponent. */
function publicKeyFromJwk(jwk: Jwk) {
  return createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
}

/**
 * Verify a Clerk session token. Returns its claims, or null for anything
 * malformed, expired, or incorrectly signed — callers treat null as
 * "not signed in" rather than surfacing an error.
 */
export async function verifyClerkSessionToken(token: string): Promise<ClerkClaims | null> {
  try {
    const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
    if (!headerSegment || !payloadSegment || !signatureSegment) return null;

    const header = JSON.parse(base64UrlDecode(headerSegment).toString()) as { alg: string; kid: string };
    // Reject anything that isn't the algorithm we expect — notably "none".
    if (header.alg !== "RS256" || !header.kid) return null;

    let keys = await getJwks();
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      // Unknown kid usually means key rotation; refetch once before giving up.
      keys = await getJwks(true);
      jwk = keys.find((k) => k.kid === header.kid);
    }
    if (!jwk) return null;

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerSegment}.${payloadSegment}`);
    verifier.end();
    if (!verifier.verify(publicKeyFromJwk(jwk), base64UrlDecode(signatureSegment))) return null;

    const claims = JSON.parse(base64UrlDecode(payloadSegment).toString()) as ClerkClaims;
    const now = Math.floor(Date.now() / 1000);
    // Small skew allowance so a slightly fast clock doesn't reject valid tokens.
    const skew = 5;
    if (typeof claims.exp !== "number" || claims.exp + skew < now) return null;
    if (typeof claims.nbf === "number" && claims.nbf - skew > now) return null;
    if (!claims.sub) return null;

    const expectedIssuer = process.env.CLERK_ISSUER;
    if (expectedIssuer && claims.iss && claims.iss.replace(/\/$/, "") !== expectedIssuer.replace(/\/$/, "")) {
      return null;
    }
    return claims;
  } catch (err) {
    logger.warn("clerk_token_verification_failed", { error: String(err) });
    return null;
  }
}

/** Test hook. */
export function resetJwksCache(): void {
  jwksCache = null;
}
