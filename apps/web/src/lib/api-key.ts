import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { newId } from "@fav/core";
import { apiKeys, getDb } from "@fav/db";

export const API_SCOPES = ["videos:read", "videos:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Issue a key (FAV-1501): plaintext returned exactly once, only the hash stored. */
export async function issueApiKey(args: {
  orgId: string;
  name: string;
  scopes: ApiScope[];
  createdByUserId: string;
}): Promise<{ id: string; plaintext: string }> {
  const plaintext = `fav_live_${randomBytes(24).toString("hex")}`;
  const id = newId("key");
  await getDb().insert(apiKeys).values({
    id,
    orgId: args.orgId,
    name: args.name,
    keyHash: hashKey(plaintext),
    keyPrefix: plaintext.slice(0, 16),
    scopes: args.scopes,
    createdByUserId: args.createdByUserId
  });
  return { id, plaintext };
}

export interface ApiKeyContext {
  keyId: string;
  orgId: string;
  scopes: string[];
}

/** Authenticate a Bearer API key (FAV-1502 AC: auth via API key). */
export async function authenticateApiKey(authorization: string | null): Promise<ApiKeyContext | null> {
  if (!authorization?.startsWith("Bearer fav_live_")) return null;
  const plaintext = authorization.slice("Bearer ".length);
  const db = getDb();
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashKey(plaintext)));
  if (!row || row.revokedAt) return null;
  // Metering: track usage per key (FAV-1501 AC).
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return { keyId: row.id, orgId: row.orgId, scopes: row.scopes };
}

export function hasScope(ctx: ApiKeyContext, scope: ApiScope): boolean {
  return ctx.scopes.includes(scope);
}
