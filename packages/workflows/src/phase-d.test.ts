import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, migrateTestDb, seed, computeBalance, scenes, socialAccounts, publishJobs, videos, type Db } from "@fav/db";
import {
  MockLlmProvider,
  MockModerationProvider,
  MockTranscriptionProvider,
  MockTtsProvider,
  MockVisualsProvider,
  MockPublisherProvider,
  FsStorageProvider,
  encryptSecret,
  decryptSecret
} from "@fav/providers";
import { newId, videoRequestSchema } from "@fav/core";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGenerationJob, enqueueGenerationRun, runGenerationJob } from "./generation.js";
import { createRerollJob, runRerollJob } from "./reroll.js";
import { createPublishJob, runPublishJob } from "./publish.js";
import { applySceneEdit } from "./maintenance.js";
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

describe("secret encryption (FAV-1603)", () => {
  it("roundtrips and never stores plaintext", () => {
    const secret = "ya29.a0AfB_super-secret-oauth-token";
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("rejects tampered ciphertext", () => {
    const stored = encryptSecret("secret");
    const parts = stored.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("tampered!").toString("base64")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("scene re-roll (FAV-505)", () => {
  let db: Db;
  let deps: PipelineDeps;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
    deps = makeDeps(db);
  });

  it("re-rolls one scene, charges incrementally, invalidates the final render", async () => {
    const request = videoRequestSchema.parse({ topic: "the physics of surfing", durationSeconds: 25 });
    const { videoId, jobId } = await createGenerationJob(db, { orgId: ORG, request });
    await runGenerationJob(deps, jobId);
    const balanceAfterGen = await computeBalance(db, ORG);

    const [sceneBefore] = await db.select().from(scenes).where(eq(scenes.videoId, videoId));
    const oldImage = await deps.storage.get(sceneBefore!.imageAssetKey!);

    const { jobId: rerollId } = await createRerollJob(db, { orgId: ORG, videoId, sceneIndex: 0 });
    await runRerollJob(deps, rerollId);

    // Incremental charge (basic tier = 1 credit), asset replaced in place.
    expect(await computeBalance(db, ORG)).toBe(balanceAfterGen - 1);
    const [sceneAfter] = await db.select().from(scenes).where(eq(scenes.videoId, videoId));
    expect(sceneAfter!.rerollCount).toBe(1);
    const newImage = await deps.storage.get(sceneAfter!.imageAssetKey!);
    expect(newImage.equals(oldImage)).toBe(false);

    // Final render invalidated -> draft, and re-render completes again.
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video!.status).toBe("draft");
    expect(video!.finalAssetKey).toBeNull();

    const { jobId: rerenderId } = await enqueueGenerationRun(db, { orgId: ORG, videoId });
    await runGenerationJob(deps, rerenderId);
    const [videoAfter] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(videoAfter!.status).toBe("completed");
  });

  it("scene narration edit invalidates voice + captions, re-render regenerates them", async () => {
    const request = videoRequestSchema.parse({ topic: "urban beekeeping", durationSeconds: 25 });
    const { videoId, jobId } = await createGenerationJob(db, { orgId: ORG, request });
    await runGenerationJob(deps, jobId);

    await applySceneEdit(db, { videoId, sceneIndex: 0, narration: "A completely new opening line for this video." });
    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video!.narrationAssetKey).toBeNull();
    expect(video!.finalAssetKey).toBeNull();
    // The edit persisted into the script too (FAV-404 AC).
    const script = video!.script as { scenes: Array<{ narration: string }> };
    expect(script.scenes[0]!.narration).toContain("completely new opening");

    const { jobId: rerenderId } = await enqueueGenerationRun(db, { orgId: ORG, videoId });
    await runGenerationJob(deps, rerenderId);
    const [after] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(after!.status).toBe("completed");
    expect(after!.narrationAssetKey).toBeTruthy();
  });
});

describe("publishing (FAV-1302/1305/1306)", () => {
  let db: Db;
  let deps: PipelineDeps;
  let videoId: string;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
    deps = makeDeps(db);
    const request = videoRequestSchema.parse({ topic: "test publish", durationSeconds: 25 });
    const created = await createGenerationJob(db, { orgId: ORG, request });
    videoId = created.videoId;
    await runGenerationJob(deps, created.jobId);
  });

  async function connectMockAccount(expiresInMs = 3600_000) {
    const publisher = new MockPublisherProvider("youtube", "http://test");
    const { tokens, externalAccountId, displayName } = await publisher.exchangeCode({
      code: "mockcode_abc",
      redirectUri: "http://test/cb"
    });
    const id = newId("soc");
    await db.insert(socialAccounts).values({
      id,
      orgId: ORG,
      platform: "youtube",
      externalAccountId,
      displayName,
      accessTokenEncrypted: encryptSecret(tokens.accessToken),
      refreshTokenEncrypted: encryptSecret(tokens.refreshToken!),
      tokenExpiresAt: new Date(Date.now() + expiresInMs),
      scopes: tokens.scopes,
      status: "connected"
    });
    return id;
  }

  it("publishes with token refresh and records the external post id", async () => {
    // Token that's about to expire forces the refresh path (FAV-1305).
    const accountId = await connectMockAccount(60_000);
    const { publishJobId } = await createPublishJob(db, {
      orgId: ORG,
      videoId,
      socialAccountId: accountId,
      platform: "youtube",
      title: "My test video"
    });
    await runPublishJob(deps, publishJobId);

    const [job] = await db.select().from(publishJobs).where(eq(publishJobs.id, publishJobId));
    expect(job!.status).toBe("published");
    expect(job!.externalPostId).toMatch(/^youtube_post_/);
    expect(job!.publishedAt).toBeTruthy();

    // The refresh rotated the stored access token and pushed expiry forward.
    const [account] = await db.select().from(socialAccounts).where(eq(socialAccounts.id, accountId));
    expect(account!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
  });
});
