import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, migrateTestDb, seed, autopilotRules, autopilotRuns, publishJobs, socialAccounts, videos, type Db } from "@fav/db";
import {
  MockLlmProvider,
  MockModerationProvider,
  MockTranscriptionProvider,
  MockTtsProvider,
  MockVisualsProvider,
  MockPublisherProvider,
  FsStorageProvider,
  encryptSecret
} from "@fav/providers";
import { newId } from "@fav/core";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { computeNextRun, runAutopilotRule, sweepDueAutopilotRules } from "./autopilot.js";
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

async function connectAccount(db: Db): Promise<string> {
  const publisher = new MockPublisherProvider("youtube", "http://test");
  const { tokens, externalAccountId, displayName } = await publisher.exchangeCode({
    code: "mockcode_x",
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
    tokenExpiresAt: new Date(tokens.expiresAt),
    scopes: tokens.scopes,
    status: "connected"
  });
  return id;
}

describe("autopilot (FAV-14xx)", () => {
  let db: Db;
  let deps: PipelineDeps;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
    deps = makeDeps(db);
  });

  it("computes next runs for every cadence form (FAV-1402)", () => {
    const from = new Date("2026-08-01T12:00:00Z");
    expect(computeNextRun("daily", from).toISOString()).toBe("2026-08-02T12:00:00.000Z");
    expect(computeNextRun("weekly", from).toISOString()).toBe("2026-08-08T12:00:00.000Z");
    expect(computeNextRun("every:12h", from).toISOString()).toBe("2026-08-02T00:00:00.000Z");
    expect(computeNextRun("every:3d", from).toISOString()).toBe("2026-08-04T12:00:00.000Z");
    expect(() => computeNextRun("sometimes", from)).toThrow();
  });

  it("runs the full idea -> generate -> publish loop and varies topics (FAV-1403/1404)", async () => {
    const accountId = await connectAccount(db);
    const ruleId = newId("apr");
    await db.insert(autopilotRules).values({
      id: ruleId,
      orgId: ORG,
      name: "Daily ocean facts",
      niche: "deep ocean mysteries",
      cadence: "daily",
      socialAccountId: accountId,
      videoDefaults: { durationSeconds: 25 },
      enabled: true,
      nextRunAt: new Date()
    });

    const { runId } = await runAutopilotRule(deps, ruleId);
    const [run] = await db.select().from(autopilotRuns).where(eq(autopilotRuns.id, runId));
    expect(run!.status).toBe("completed");
    expect(run!.ideaTopic).toBeTruthy();
    expect(run!.creditsSpent).toBeGreaterThan(0);

    // Published automatically (no review gate).
    const [pub] = await db.select().from(publishJobs).where(eq(publishJobs.id, run!.publishJobId!));
    expect(pub!.status).toBe("published");

    // Second run generates a different topic (originality, FAV-1404).
    const { runId: secondRunId } = await runAutopilotRule(deps, ruleId);
    const [second] = await db.select().from(autopilotRuns).where(eq(autopilotRuns.id, secondRunId));
    expect(second!.ideaTopic).not.toBe(run!.ideaTopic);

    const [rule] = await db.select().from(autopilotRules).where(eq(autopilotRules.id, ruleId));
    expect(rule!.recentTopics).toContain(run!.ideaTopic);
    expect(rule!.recentTopics).toContain(second!.ideaTopic);
  });

  it("review gate holds runs unpublished (FAV-1404)", async () => {
    const ruleId = newId("apr");
    await db.insert(autopilotRules).values({
      id: ruleId,
      orgId: ORG,
      name: "Reviewed content",
      niche: "medical history",
      cadence: "daily",
      videoDefaults: { durationSeconds: 25 },
      requiresReview: true,
      enabled: true,
      nextRunAt: new Date()
    });
    const { runId } = await runAutopilotRule(deps, ruleId);
    const [run] = await db.select().from(autopilotRuns).where(eq(autopilotRuns.id, runId));
    expect(run!.status).toBe("awaiting_review");
    expect(run!.publishJobId).toBeNull();
    // The video itself exists and completed.
    const [video] = await db.select().from(videos).where(eq(videos.id, run!.videoId!));
    expect(video!.status).toBe("completed");
  });

  it("sweep fires due rules, advances schedules, skips future ones (FAV-1402)", async () => {
    const dueId = newId("apr");
    const futureId = newId("apr");
    await db.insert(autopilotRules).values([
      {
        id: dueId,
        orgId: ORG,
        name: "Due",
        niche: "space",
        cadence: "daily",
        videoDefaults: { durationSeconds: 25 },
        enabled: true,
        nextRunAt: new Date(Date.now() - 1000)
      },
      {
        id: futureId,
        orgId: ORG,
        name: "Future",
        niche: "space",
        cadence: "daily",
        videoDefaults: { durationSeconds: 25 },
        enabled: true,
        nextRunAt: new Date(Date.now() + 3600_000)
      }
    ]);

    const { fired } = await sweepDueAutopilotRules(deps);
    expect(fired.length).toBe(1);

    const [due] = await db.select().from(autopilotRules).where(eq(autopilotRules.id, dueId));
    // Missed-run handling: rescheduled from now, not from the stale slot.
    expect(due!.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const futureRuns = await db.select().from(autopilotRuns).where(eq(autopilotRuns.ruleId, futureId));
    expect(futureRuns.length).toBe(0);
  });
});
