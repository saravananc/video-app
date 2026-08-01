import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, migrateTestDb, seed, computeBalance, jobs, videos } from "@fav/db";
import type { Db } from "@fav/db";
import {
  MockLlmProvider,
  MockModerationProvider,
  MockTranscriptionProvider,
  MockTtsProvider,
  MockVisualsProvider,
  FsStorageProvider
} from "@fav/providers";
import { newId, videoRequestSchema } from "@fav/core";
import { eq, sql } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGenerationJob } from "./generation.js";
import { claimJobById, claimNextJob, reclaimExpiredLeases, startWorker } from "./queue.js";
import type { PipelineDeps } from "./deps.js";

const ORG = "org_demo";

function makeDeps(db: Db, renderDelayMs = 0): PipelineDeps {
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
      if (renderDelayMs) await new Promise((r) => setTimeout(r, renderDelayMs));
      await writeFile(outPath, Buffer.from("fake-mp4"));
      return { outPath, sizeBytes: 8 };
    })
  };
}

async function enqueue(db: Db, topic: string) {
  const request = videoRequestSchema.parse({ topic, durationSeconds: 25 });
  return createGenerationJob(db, { orgId: ORG, request });
}

describe("durable job queue (FAV-901/807)", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
  });

  it("claims the oldest queued job and leases it to one worker", async () => {
    const first = await enqueue(db, "oldest job");
    await new Promise((r) => setTimeout(r, 10));
    await enqueue(db, "newer job");

    const claimed = await claimNextJob(db, "worker-a");
    expect(claimed?.id).toBe(first.jobId);
    expect(claimed?.status).toBe("running");
    expect(claimed?.workerId).toBe("worker-a");
    expect(claimed?.leasedUntil).toBeTruthy();
    expect(claimed?.attempts).toBe(1);
  });

  it("never hands the same job to two workers", async () => {
    await enqueue(db, "only job");
    const a = await claimNextJob(db, "worker-a");
    const b = await claimNextJob(db, "worker-b");
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("concurrent claims across workers each get a distinct job", async () => {
    const created = await Promise.all([
      enqueue(db, "job one"),
      enqueue(db, "job two"),
      enqueue(db, "job three")
    ]);
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, i) => claimNextJob(db, `worker-${i}`))
    );
    const claimedIds = claims.filter(Boolean).map((c) => c!.id);
    expect(claimedIds.length).toBe(3);
    expect(new Set(claimedIds).size).toBe(3);
    expect(new Set(claimedIds)).toEqual(new Set(created.map((c) => c.jobId)));
  });

  it("reclaims a job whose worker died (expired lease) — the durability guarantee", async () => {
    const { jobId } = await enqueue(db, "crashed mid-run");
    const claimed = await claimNextJob(db, "worker-that-dies");
    expect(claimed?.id).toBe(jobId);

    // No other worker may take it while the lease is live.
    expect(await claimNextJob(db, "worker-b")).toBeNull();

    // Simulate the worker dying: its lease lapses with the job still `running`.
    await db.execute(sql`UPDATE jobs SET leased_until = now() - interval '1 second' WHERE id = ${jobId}`);

    const reclaimed = await claimNextJob(db, "worker-b");
    expect(reclaimed?.id).toBe(jobId);
    expect(reclaimed?.workerId).toBe("worker-b");
    expect(reclaimed?.attempts).toBe(2);
  });

  it("does not reclaim completed or failed jobs", async () => {
    const { jobId } = await enqueue(db, "already done");
    await claimNextJob(db, "worker-a");
    await db.update(jobs).set({ status: "completed" }).where(eq(jobs.id, jobId));
    await db.execute(sql`UPDATE jobs SET leased_until = now() - interval '1 second' WHERE id = ${jobId}`);
    expect(await claimNextJob(db, "worker-b")).toBeNull();
  });

  it("claimJobById is exclusive, so autopilot can safely run inline", async () => {
    const { jobId } = await enqueue(db, "autopilot inline");
    expect(await claimJobById(db, jobId, "autopilot")).not.toBeNull();
    // A queue worker now finds nothing to claim.
    expect(await claimNextJob(db, "worker-a")).toBeNull();
    expect(await claimJobById(db, jobId, "worker-a")).toBeNull();
  });

  it("reclaimExpiredLeases requeues abandoned jobs", async () => {
    const { jobId } = await enqueue(db, "abandoned");
    await claimNextJob(db, "dead-worker");
    await db.execute(sql`UPDATE jobs SET leased_until = now() - interval '1 second' WHERE id = ${jobId}`);

    const { reclaimed } = await reclaimExpiredLeases(db);
    expect(reclaimed).toBe(1);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(job!.status).toBe("queued");
    expect(job!.workerId).toBeNull();
  });

  it("a worker drains the queue end to end, producing finished videos", async () => {
    const deps = makeDeps(db);
    const a = await enqueue(db, "worker drains one");
    const b = await enqueue(db, "worker drains two");

    const worker = startWorker(deps, { concurrency: 2, pollIntervalMs: 10, stopWhenDrained: true });
    await worker.done;

    for (const { videoId, jobId } of [a, b]) {
      const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      expect(video!.status).toBe("completed");
      expect(job!.status).toBe("completed");
      // Lease released on completion.
      expect(job!.leasedUntil).toBeNull();
      expect(job!.workerId).toBeNull();
    }
  });

  it("two workers split the queue without duplicating render work", async () => {
    const deps = makeDeps(db, 20);
    await Promise.all([enqueue(db, "split one"), enqueue(db, "split two"), enqueue(db, "split three")]);

    const w1 = startWorker(deps, { concurrency: 1, pollIntervalMs: 5, stopWhenDrained: true, workerId: "w1" });
    const w2 = startWorker(deps, { concurrency: 1, pollIntervalMs: 5, stopWhenDrained: true, workerId: "w2" });
    await Promise.all([w1.done, w2.done]);

    const all = await db.select().from(jobs).where(eq(jobs.kind, "generation"));
    expect(all.every((j) => j.status === "completed")).toBe(true);
    // Exactly one render per job — no double work despite two workers.
    expect((deps.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    expect(all.every((j) => j.attempts === 1)).toBe(true);
  });

  it("a failing job is marked failed and refunded, not retried forever", async () => {
    const deps = makeDeps(db);
    deps.render = vi.fn(async () => {
      throw new Error("render exploded");
    });
    const startingBalance = await computeBalance(db, ORG);
    await enqueue(db, "doomed job");

    const worker = startWorker(deps, { concurrency: 1, pollIntervalMs: 10, stopWhenDrained: true });
    await worker.done;

    const [job] = await db.select().from(jobs).where(eq(jobs.kind, "generation"));
    expect(job!.status).toBe("failed");
    expect(job!.leasedUntil).toBeNull();
    expect(await computeBalance(db, ORG)).toBe(startingBalance);
    // Terminal, so a second drain does nothing.
    const again = startWorker(deps, { concurrency: 1, pollIntervalMs: 10, stopWhenDrained: true });
    await again.done;
    expect((deps.render as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("jobs survive a restart: work enqueued while nothing is running still runs", async () => {
    // Enqueue with no worker alive at all — the durable handoff is the row.
    const { videoId } = await enqueue(db, "queued before boot");
    const [before] = await db.select().from(jobs).where(eq(jobs.kind, "generation"));
    expect(before!.status).toBe("queued");

    // "Restart": a fresh worker process starts later and picks it up.
    const deps = makeDeps(db);
    const worker = startWorker(deps, { concurrency: 1, pollIntervalMs: 10, stopWhenDrained: true });
    await worker.done;

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video!.status).toBe("completed");
  });

  it("an unknown job kind fails fast instead of spinning", async () => {
    const deps = makeDeps(db);
    await db.insert(jobs).values({
      id: newId("job"),
      orgId: ORG,
      kind: "cleanup",
      status: "queued",
      idempotencyKey: `cleanup:${newId("x")}`
    });
    const worker = startWorker(deps, { concurrency: 1, pollIntervalMs: 10, stopWhenDrained: true });
    await worker.done;
    const [job] = await db.select().from(jobs).where(eq(jobs.kind, "cleanup"));
    expect(job!.status).toBe("failed");
    expect(job!.error).toMatch(/No handler/);
  });
});
