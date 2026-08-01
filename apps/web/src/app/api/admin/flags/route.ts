import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ALL_FLAG_KEYS, type FlagKey } from "@fav/core";
import { featureFlagOverrides, featureFlags, getDb, setFlagOverride } from "@fav/db";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** Feature flags + per-org overrides (FAV-1703), gated to staff. */
export async function GET() {
  try {
    await requireStaff();
    const db = getDb();
    const [flags, overrides] = await Promise.all([
      db.select().from(featureFlags),
      db.select().from(featureFlagOverrides)
    ]);
    return NextResponse.json({
      flags,
      overrides: overrides.map((o) => ({ flagKey: o.flagKey, orgId: o.orgId, enabled: o.enabled }))
    });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}

const toggleSchema = z.object({
  key: z.string(),
  /** Global default toggle. */
  defaultOn: z.boolean().optional(),
  /** Per-org override: true/false to set, null to clear and fall back to the default. */
  orgId: z.string().optional(),
  enabled: z.boolean().nullable().optional()
});

export async function PATCH(req: NextRequest) {
  try {
    await requireStaff();
    const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    if (!ALL_FLAG_KEYS.includes(parsed.data.key as FlagKey)) {
      return NextResponse.json({ error: "Unknown flag" }, { status: 404 });
    }
    const db = getDb();
    const key = parsed.data.key as FlagKey;

    if (parsed.data.orgId) {
      await setFlagOverride(db, key, parsed.data.orgId, parsed.data.enabled ?? null);
      return NextResponse.json({ ok: true, scope: "org" });
    }

    if (parsed.data.defaultOn === undefined) {
      return NextResponse.json({ error: "defaultOn or orgId required" }, { status: 400 });
    }
    const updated = await db
      .update(featureFlags)
      .set({ defaultOn: parsed.data.defaultOn })
      .where(eq(featureFlags.key, key))
      .returning();
    if (updated.length === 0) return NextResponse.json({ error: "Unknown flag" }, { status: 404 });
    return NextResponse.json({ ok: true, scope: "global", flag: updated[0] });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
