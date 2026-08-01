import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, migrateTestDb, seed, computeBalance, jobs, scenes, videos, type Db } from "@fav/db";
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
    // Fake renderer: writes a marker file instead of invoking Remotion (fast tests).
    render: vi.fn(async ({ outPath }) => {
      await writeFile(outPath, Buffer.from("fake-mp4"));
      return { outPath, sizeBytes: 8 };
    })
  };
}

describe("generation workflow (FAV-902/903/904)", () => {
  let db: Db;
  let deps: PipelineDeps;
  let startingBalance: number;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
    deps = makeDeps(db);
    startingBalance = await computeBalance(db, ORG);
  });

  async function enqueue(topic = "the history of coffee") {
    const request = videoRequestSchema.parse({ topic, durationSeconds: 30 });
    return createGenerationJob(db, { orgId: ORG, userId: "user_demo_owner", request });
  }

  it("runs end-to-end: script -> scenes -> assets -> render -> completed", async () => {
    const { videoId, jobId } = await enqueue();
    await runGenerationJob(deps, jobId);

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video!.status).toBe("completed");
    expect(video!.finalAssetKey).toBe(`videos/${videoId}/final.mp4`);
    expect(video!.script).toBeTruthy();
    expect(video!.captionCues).toBeTruthy();
    expect(video!.durationSeconds).toBeGreaterThan(0);
    expect(video!.creditsCharged).toBeGreaterThan(0);

    const sceneRows = await db.select().from(scenes).where(eq(scenes.videoId, videoId));
    expect(sceneRows.length).toBeGreaterThanOrEqual(3);
    for (const scene of sceneRows) {
      expect(scene.imageAssetKey).toBeTruthy();
      expect(scene.status).toBe("completed");
      expect(scene.audioEndSec).toBeGreaterThan(scene.audioStartSec ?? 0);
    }

    expect(await deps.storage.exists(`videos/${videoId}/final.mp4`)).toBe(true);

    // Charged = estimated-or-less, ledger consistent (FAV-904).
    const balance = await computeBalance(db, ORG);
    expect(balance).toBe(startingBalance - video!.creditsCharged!);
  });

  it("re-running a completed job is a no-op (FAV-903)", async () => {
    const { jobId } = await enqueue();
    await runGenerationJob(deps, jobId);
    const balanceAfterFirst = await computeBalance(db, ORG);
    const renderCalls = (deps.render as ReturnType<typeof vi.fn>).mock.calls.length;

    await runGenerationJob(deps, jobId);
    expect(await computeBalance(db, ORG)).toBe(balanceAfterFirst);
    expect((deps.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(renderCalls);
  });

  it("retry after mid-pipeline failure resumes without duplicating work", async () => {
    const { videoId, jobId } = await enqueue();
    const originalSynthesize = deps.tts.synthesize.bind(deps.tts);
    deps.tts.synthesize = vi.fn(async () => {
      throw new Error("TTS transient outage");
    });

    await expect(runGenerationJob(deps, jobId)).rejects.toThrow("TTS transient outage");
    // Refunded on failure (FAV-904).
    expect(await computeBalance(db, ORG)).toBe(startingBalance);
    const imagesGenerated = (await db.select().from(scenes).where(eq(scenes.videoId, videoId))).filter(
      (s) => s.imageAssetKey
    ).length;
    expect(imagesGenerated).toBeGreaterThan(0);

    // Recovery: provider back up, retry the same job.
    deps.tts.synthesize = originalSynthesize;
    await runGenerationJob(deps, jobId);
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video!.status).toBe("completed");

    // Scene images were NOT regenerated on retry (idempotency, FAV-903).
    const sceneRows = await db.select().from(scenes).where(eq(scenes.videoId, videoId));
    expect(sceneRows.filter((s) => s.imageAssetKey).length).toBe(sceneRows.length);
  });

  it("blocked topics fail terminally with a clear message and full refund (FAV-405)", async () => {
    const { videoId, jobId } = await enqueue("how to make a bomb at home");
    await expect(runGenerationJob(deps, jobId)).rejects.toThrow(/topic can't be generated/);

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video!.status).toBe("failed");
    expect(video!.errorMessage).toMatch(/different topic/);
    expect(await computeBalance(db, ORG)).toBe(startingBalance);
    expect(deps.render).not.toHaveBeenCalled();
  });

  it("render failure triggers refund (FAV-808)", async () => {
    const { jobId } = await enqueue();
    deps.render = vi.fn(async () => {
      throw new Error("render crashed");
    });
    await expect(runGenerationJob(deps, jobId)).rejects.toThrow("render crashed");
    expect(await computeBalance(db, ORG)).toBe(startingBalance);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(job!.status).toBe("failed");
  });
});
