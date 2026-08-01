import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, migrateTestDb, seed, computeBalance, creditLedger, scenes, videos } from "@fav/db";
import type { Db } from "@fav/db";
import {
  MockLlmProvider,
  MockModerationProvider,
  MockTranscriptionProvider,
  MockTtsProvider,
  MockVisualsProvider,
  FsStorageProvider
} from "@fav/providers";
import { videoRequestSchema } from "@fav/core";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGenerationJob, runGenerationJob } from "./generation.js";
import { cleanupIntermediateAssets, purgeVideoAssets } from "./maintenance.js";
import { enforceDeletionRetention, runMaintenance } from "./retention.js";
import type { PipelineDeps } from "./deps.js";

const ORG = "org_demo";

function makeDeps(db: Db): PipelineDeps {
  const storageDir = mkdtempSync(path.join(os.tmpdir(), "fav-test-storage-"));
  return {
    db,
    llm: new MockLlmProvider(),
    visuals: new MockVisualsProvider(),
    fallbackVisuals: new MockVisualsProvider(),
    tts: new MockTtsProvider(),
    transcription: new MockTranscriptionProvider(),
    moderation: new MockModerationProvider(),
    storage: new FsStorageProvider(storageDir, "test-secret", "http://test"),
    render: vi.fn(async ({ outPath }) => {
      await writeFile(outPath, Buffer.from("fake-mp4"));
      return { outPath, sizeBytes: 8 };
    })
  };
}

describe("retention & deletion (FAV-1606/1003)", () => {
  let db: Db;
  let deps: PipelineDeps;
  let videoId: string;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
    deps = makeDeps(db);
    const request = videoRequestSchema.parse({ topic: "deletion test", durationSeconds: 25 });
    const created = await createGenerationJob(db, { orgId: ORG, request });
    videoId = created.videoId;
    await runGenerationJob(deps, created.jobId);
  });

  it("purges every asset and soft-deletes without breaking the append-only ledger", async () => {
    const [before] = await db.select().from(videos).where(eq(videos.id, videoId));
    const sceneRows = await db.select().from(scenes).where(eq(scenes.videoId, videoId));
    expect(await deps.storage.exists(before!.finalAssetKey!)).toBe(true);
    const ledgerBefore = await db.select().from(creditLedger).where(eq(creditLedger.videoId, videoId));
    expect(ledgerBefore.length).toBeGreaterThan(0);
    const balanceBefore = await computeBalance(db, ORG);

    await purgeVideoAssets(db, deps.storage, videoId);

    // Every stored asset is gone.
    expect(await deps.storage.exists(before!.finalAssetKey!)).toBe(false);
    expect(await deps.storage.exists(before!.narrationAssetKey!)).toBe(false);
    for (const scene of sceneRows) {
      expect(await deps.storage.exists(scene.imageAssetKey!)).toBe(false);
    }

    // Soft-delete + content scrub keeps the ledger's referential integrity
    // intact, which a hard DELETE would violate (credit_ledger.video_id FK).
    await db.delete(scenes).where(eq(scenes.videoId, videoId));
    await db
      .update(videos)
      .set({ deletedAt: new Date(), topic: "", title: "Deleted video", script: null, captionCues: null })
      .where(eq(videos.id, videoId));

    const [after] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(after!.deletedAt).toBeTruthy();
    expect(after!.topic).toBe("");
    expect(after!.script).toBeNull();

    // Audit trail and balance are untouched (FAV-303).
    const ledgerAfter = await db.select().from(creditLedger).where(eq(creditLedger.videoId, videoId));
    expect(ledgerAfter.length).toBe(ledgerBefore.length);
    expect(await computeBalance(db, ORG)).toBe(balanceBefore);
  });

  it("lifecycle cleanup expires narration but keeps finals and re-roll inputs (FAV-1003)", async () => {
    // Age the video past the retention window.
    await db
      .update(videos)
      .set({ completedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) })
      .where(eq(videos.id, videoId));

    const [before] = await db.select().from(videos).where(eq(videos.id, videoId));
    const sceneRows = await db.select().from(scenes).where(eq(scenes.videoId, videoId));

    const { cleaned } = await cleanupIntermediateAssets(db, deps.storage, 7);
    expect(cleaned).toBe(1);

    expect(await deps.storage.exists(before!.narrationAssetKey!)).toBe(false);
    // Final render retained.
    expect(await deps.storage.exists(before!.finalAssetKey!)).toBe(true);
    // Scene images retained — they're re-roll inputs.
    for (const scene of sceneRows) {
      expect(await deps.storage.exists(scene.imageAssetKey!)).toBe(true);
    }
  });

  it("the scheduled maintenance pass performs the cleanup end to end", async () => {
    await db
      .update(videos)
      .set({ completedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) })
      .where(eq(videos.id, videoId));
    const [before] = await db.select().from(videos).where(eq(videos.id, videoId));

    const result = await runMaintenance(db, deps.storage);

    expect(result.intermediatesCleaned).toBe(1);
    expect(await deps.storage.exists(before!.narrationAssetKey!)).toBe(false);
    expect(result.ranAt).toBeTruthy();
  });

  it("retention sweep scrubs long-soft-deleted videos that still hold assets", async () => {
    const [before] = await db.select().from(videos).where(eq(videos.id, videoId));
    // A delete that failed partway: marked deleted long ago, assets still present.
    await db
      .update(videos)
      .set({ deletedAt: new Date(Date.now() - 60 * 24 * 3600 * 1000) })
      .where(eq(videos.id, videoId));
    expect(await deps.storage.exists(before!.finalAssetKey!)).toBe(true);

    const { scrubbed } = await enforceDeletionRetention(db, deps.storage, 30);
    expect(scrubbed).toBe(1);
    expect(await deps.storage.exists(before!.finalAssetKey!)).toBe(false);

    const [after] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(after!.finalAssetKey).toBeNull();
    expect(after!.script).toBeNull();
    // Row survives for ledger integrity.
    expect(after!.id).toBe(videoId);
  });

  it("retention sweep leaves recently deleted videos alone", async () => {
    await db.update(videos).set({ deletedAt: new Date() }).where(eq(videos.id, videoId));
    const { scrubbed } = await enforceDeletionRetention(db, deps.storage, 30);
    expect(scrubbed).toBe(0);
  });
});
