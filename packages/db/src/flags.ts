import { and, eq } from "drizzle-orm";
import { ALL_FLAG_KEYS, type FlagKey } from "@fav/core";
import type { Db } from "./client.js";
import { featureFlagOverrides, featureFlags } from "./schema.js";

/**
 * Flag evaluation (FAV-1703): a per-org override wins over the flag's global
 * default. Unknown keys are treated as off — a missing flag row must never
 * silently enable a gated feature.
 */
export async function isFeatureEnabled(db: Db, key: FlagKey, orgId: string): Promise<boolean> {
  const [override] = await db
    .select({ enabled: featureFlagOverrides.enabled })
    .from(featureFlagOverrides)
    .where(and(eq(featureFlagOverrides.flagKey, key), eq(featureFlagOverrides.orgId, orgId)));
  if (override) return override.enabled;

  const [flag] = await db
    .select({ defaultOn: featureFlags.defaultOn })
    .from(featureFlags)
    .where(eq(featureFlags.key, key));
  return flag?.defaultOn ?? false;
}

/** Resolve every flag for an org in one pass — used by the UI to hide gated controls. */
export async function resolveFlags(db: Db, orgId: string): Promise<Record<FlagKey, boolean>> {
  const [flags, overrides] = await Promise.all([
    db.select({ key: featureFlags.key, defaultOn: featureFlags.defaultOn }).from(featureFlags),
    db
      .select({ flagKey: featureFlagOverrides.flagKey, enabled: featureFlagOverrides.enabled })
      .from(featureFlagOverrides)
      .where(eq(featureFlagOverrides.orgId, orgId))
  ]);

  const defaults = new Map(flags.map((f) => [f.key, f.defaultOn]));
  const overrideMap = new Map(overrides.map((o) => [o.flagKey, o.enabled]));

  const resolved = {} as Record<FlagKey, boolean>;
  for (const key of ALL_FLAG_KEYS) {
    resolved[key] = overrideMap.get(key) ?? defaults.get(key) ?? false;
  }
  return resolved;
}

/** Set or clear a per-org override (null clears, falling back to the default). */
export async function setFlagOverride(
  db: Db,
  key: FlagKey,
  orgId: string,
  enabled: boolean | null
): Promise<void> {
  if (enabled === null) {
    await db
      .delete(featureFlagOverrides)
      .where(and(eq(featureFlagOverrides.flagKey, key), eq(featureFlagOverrides.orgId, orgId)));
    return;
  }
  await db
    .insert(featureFlagOverrides)
    .values({ flagKey: key, orgId, enabled })
    .onConflictDoUpdate({
      target: [featureFlagOverrides.flagKey, featureFlagOverrides.orgId],
      set: { enabled }
    });
}
