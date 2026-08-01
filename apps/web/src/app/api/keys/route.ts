import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { FLAG_KEYS } from "@fav/core";
import { apiKeys, getDb } from "@fav/db";
import { authErrorResponse, requireBillingAccess, requireFeature } from "@/lib/org";
import { API_SCOPES, issueApiKey } from "@/lib/api-key";

export const dynamic = "force-dynamic";

/** List the org's API keys (never the secrets) (FAV-1501). */
export async function GET() {
  try {
    const session = await requireBillingAccess();
    const rows = await getDb()
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt
      })
      .from(apiKeys)
      .where(eq(apiKeys.orgId, session.orgId))
      .orderBy(desc(apiKeys.createdAt));
    return NextResponse.json({ keys: rows });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1).default(["videos:read", "videos:write"])
});

/** Issue a key — plaintext shown exactly once. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireBillingAccess();
    await requireFeature(session.orgId, FLAG_KEYS.publicApi);
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const { id, plaintext } = await issueApiKey({
      orgId: session.orgId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      createdByUserId: session.userId
    });
    return NextResponse.json({ id, key: plaintext }, { status: 201 });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
