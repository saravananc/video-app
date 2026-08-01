import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FLAG_KEYS } from "@fav/core";
import { createTestDb, type Db } from "./client.js";
import { migrateTestDb } from "./migrate.js";
import { seed } from "./seed.js";
import { isFeatureEnabled, resolveFlags, setFlagOverride } from "./flags.js";
import { featureFlags } from "./schema.js";

const ORG = "org_demo";
const OTHER_ORG = "org_other";

describe("feature flags (FAV-1703)", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
    await db.insert(await import("./schema.js").then((m) => m.organizations)).values({
      id: OTHER_ORG,
      name: "Other",
      slug: "other"
    });
  });

  it("falls back to the global default when no override exists", async () => {
    // Seeded: voice_cloning on, autopilot off.
    expect(await isFeatureEnabled(db, FLAG_KEYS.voiceCloning, ORG)).toBe(true);
    expect(await isFeatureEnabled(db, FLAG_KEYS.autopilot, ORG)).toBe(false);
  });

  it("per-org override beats the global default, in both directions", async () => {
    await setFlagOverride(db, FLAG_KEYS.autopilot, ORG, true);
    await setFlagOverride(db, FLAG_KEYS.voiceCloning, ORG, false);

    expect(await isFeatureEnabled(db, FLAG_KEYS.autopilot, ORG)).toBe(true);
    expect(await isFeatureEnabled(db, FLAG_KEYS.voiceCloning, ORG)).toBe(false);

    // Other orgs are unaffected.
    expect(await isFeatureEnabled(db, FLAG_KEYS.autopilot, OTHER_ORG)).toBe(false);
    expect(await isFeatureEnabled(db, FLAG_KEYS.voiceCloning, OTHER_ORG)).toBe(true);
  });

  it("clearing an override restores the default", async () => {
    await setFlagOverride(db, FLAG_KEYS.autopilot, ORG, true);
    expect(await isFeatureEnabled(db, FLAG_KEYS.autopilot, ORG)).toBe(true);
    await setFlagOverride(db, FLAG_KEYS.autopilot, ORG, null);
    expect(await isFeatureEnabled(db, FLAG_KEYS.autopilot, ORG)).toBe(false);
  });

  it("overrides are upserted, not duplicated", async () => {
    await setFlagOverride(db, FLAG_KEYS.autopilot, ORG, true);
    await setFlagOverride(db, FLAG_KEYS.autopilot, ORG, false);
    expect(await isFeatureEnabled(db, FLAG_KEYS.autopilot, ORG)).toBe(false);
  });

  it("an unknown flag is off — a missing row never enables a gated feature", async () => {
    await db.delete(featureFlags).where(eq(featureFlags.key, FLAG_KEYS.textToVideo));
    expect(await isFeatureEnabled(db, FLAG_KEYS.textToVideo, ORG)).toBe(false);
  });

  it("resolveFlags returns every known key for the UI", async () => {
    await setFlagOverride(db, FLAG_KEYS.publicApi, ORG, true);
    const flags = await resolveFlags(db, ORG);
    expect(Object.keys(flags).sort()).toEqual(
      [FLAG_KEYS.autopilot, FLAG_KEYS.publicApi, FLAG_KEYS.textToVideo, FLAG_KEYS.voiceCloning].sort()
    );
    expect(flags.public_api).toBe(true);
    expect(flags.autopilot).toBe(false);
  });
});
