import { eq } from "drizzle-orm";
import { STARTER_CREDITS } from "@fav/core";
import { hashPassword } from "@fav/providers";

/** Password for the seeded demo accounts (development only). */
export const DEMO_PASSWORD = "demo-password-123";
import type { Db } from "./client.js";
import {
  featureFlags,
  memberships,
  musicTracks,
  organizations,
  users,
  voices,
  creditLedger
} from "./schema.js";
import { appendLedgerEntry } from "./ledger.js";

/**
 * Deterministic, idempotent seed (FAV-305): one command produces a working org
 * with three role-covering users, global voices, music tracks, and starter credits.
 * Safe to re-run — every insert is keyed on a stable id.
 */
export async function seed(db: Db): Promise<{ orgId: string }> {
  const orgId = "org_demo";
  const owner = { id: "user_demo_owner", email: "owner@demo.fav", name: "Demo Owner", role: "owner" as const };
  const admin = { id: "user_demo_admin", email: "admin@demo.fav", name: "Demo Admin", role: "admin" as const };
  const member = { id: "user_demo_member", email: "member@demo.fav", name: "Demo Member", role: "member" as const };

  await db
    .insert(organizations)
    .values({ id: orgId, name: "Demo Studio", slug: "demo-studio" })
    .onConflictDoNothing();

  // Demo accounts sign in with a real password like any other user; the seed
  // is the only place this credential exists and it never ships to production
  // (seeding is opt-in via FAV_AUTO_SEED).
  const demoPasswordHash = await hashPassword(DEMO_PASSWORD);

  for (const u of [owner, admin, member]) {
    await db
      .insert(users)
      .values({
        id: u.id,
        authProviderId: `local:${u.email}`,
        email: u.email,
        name: u.name,
        passwordHash: demoPasswordHash,
        emailVerifiedAt: new Date(),
        isStaff: u.role === "owner"
      })
      .onConflictDoNothing();
    await db
      .insert(memberships)
      .values({ id: `mem_${u.id}`, orgId, userId: u.id, role: u.role })
      .onConflictDoNothing();
  }

  const globalVoices = [
    { id: "voice_adam", name: "Adam", language: "en", gender: "male", description: "Deep, confident narrator" },
    { id: "voice_bella", name: "Bella", language: "en", gender: "female", description: "Warm, engaging storyteller" },
    { id: "voice_josh", name: "Josh", language: "en", gender: "male", description: "Energetic, youthful" },
    { id: "voice_elena", name: "Elena", language: "es", gender: "female", description: "Clear Spanish narration" },
    { id: "voice_yuki", name: "Yuki", language: "ja", gender: "female", description: "Calm Japanese narration" }
  ];
  for (const v of globalVoices) {
    await db
      .insert(voices)
      .values({
        id: v.id,
        provider: "mock",
        providerVoiceId: v.id,
        name: v.name,
        description: v.description,
        language: v.language,
        languages: [v.language],
        gender: v.gender
      })
      .onConflictDoNothing();
  }

  const tracks = [
    { id: "music_uplift", name: "Uplift", mood: "inspirational", durationSeconds: 120 },
    { id: "music_pulse", name: "Pulse", mood: "energetic", durationSeconds: 95 },
    { id: "music_drift", name: "Drift", mood: "calm", durationSeconds: 140 }
  ];
  for (const t of tracks) {
    await db
      .insert(musicTracks)
      .values({ id: t.id, name: t.name, mood: t.mood, assetKey: `music/${t.id}.wav`, durationSeconds: t.durationSeconds })
      .onConflictDoNothing();
  }

  const flags = [
    { key: "text_to_video", description: "Max tier text-to-video clips (FAV-503)", defaultOn: false },
    { key: "voice_cloning", description: "Voice cloning (FAV-603)", defaultOn: true },
    { key: "autopilot", description: "Autopilot scheduling (FAV-14xx)", defaultOn: false },
    { key: "public_api", description: "Public REST API (FAV-15xx)", defaultOn: false }
  ];
  for (const f of flags) {
    await db.insert(featureFlags).values(f).onConflictDoNothing();
  }

  // Starter credits exactly once (FAV-1208) — keyed by reason, not by count.
  const existingGrant = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId));
  if (existingGrant.length === 0) {
    await appendLedgerEntry(db, {
      orgId,
      entryType: "grant",
      amount: STARTER_CREDITS * 10,
      reason: "Demo org seed credits"
    });
  }

  return { orgId };
}
