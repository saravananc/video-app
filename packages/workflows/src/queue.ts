import { and, eq, sql } from "drizzle-orm";
import { newId } from "@fav/core";
import { jobs, type Db } from "@fav/db";
import type { PipelineDeps } from "./deps.js";
import { runGenerationJob } from "./generation.js";
import { runRerollJob } from "./reroll.js";
import { runPublishJob } from "./publish.js";

/**
 * Durable job queue (FAV-901/807) built on the jobs table.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so many workers can pull from the
 * same queue without coordination and without handing the same job to two
 * workers. A claim takes a time-boxed lease that the worker extends by
 * heartbeat while running; if the worker dies, the lease lapses and another
 * worker reclaims the job. Because every pipeline step is idempotent on
 * domain state (FAV-903), that re-run resumes from where the crash happened
 * rather than duplicating work or double-charging.
 *
 * Note on failure semantics: a job that *errors* is already terminal — the
 * workflow refunds and marks it failed on the way out, and operators re-run it
 * from the admin UI. The queue only auto-recovers jobs interrupted mid-flight
 * (expired lease), where no refund was ever written. Transient provider errors
 * are retried a layer lower, inside the model gateway.
 */

export const LEASE_MS = Number(process.env.FAV_JOB_LEASE_MS ?? 120_000);
export const HEARTBEAT_MS = Math.max(5_000, Math.floor(LEASE_MS / 3));

export type ClaimedJob = typeof jobs.$inferSelect;

/**
 * Raw `execute` bypasses Drizzle's column mapping, so RETURNING gives database
 * snake_case. Map it back to the schema shape callers expect.
 */
function toClaimedJob(row: Record<string, unknown>): ClaimedJob {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    videoId: (row.video_id ?? null) as string | null,
    kind: row.kind as ClaimedJob["kind"],
    status: row.status as ClaimedJob["status"],
    stage: (row.stage ?? null) as string | null,
    stageProgress: Number(row.stage_progress ?? 0),
    detail: (row.detail ?? null) as string | null,
    error: (row.error ?? null) as string | null,
    idempotencyKey: row.idempotency_key as string,
    attempts: Number(row.attempts ?? 0),
    leasedUntil: row.leased_until ? new Date(row.leased_until as string) : null,
    workerId: (row.worker_id ?? null) as string | null,
    traceId: (row.trace_id ?? null) as string | null,
    startedAt: row.started_at ? new Date(row.started_at as string) : null,
    finishedAt: row.finished_at ? new Date(row.finished_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string)
  };
}

/**
 * Atomically claim the oldest runnable job: either freshly queued, or one whose
 * worker died and whose lease has expired.
 */
export async function claimNextJob(db: Db, workerId: string): Promise<ClaimedJob | null> {
  const result = await db.execute(sql`
    UPDATE jobs SET
      status = 'running',
      worker_id = ${workerId},
      leased_until = now() + (${LEASE_MS} || ' milliseconds')::interval,
      started_at = coalesce(started_at, now()),
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'queued'
         OR (status = 'running' AND leased_until IS NOT NULL AND leased_until < now())
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);
  const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
  return rows[0] ? toClaimedJob(rows[0]) : null;
}

/**
 * Claim one specific job by id. Used by callers that create a job and want to
 * run it inline (the autopilot scheduler): claiming first stops a worker from
 * picking up the same job and paying for the same provider calls twice.
 * Returns null when someone else already holds it.
 */
export async function claimJobById(db: Db, jobId: string, workerId: string): Promise<ClaimedJob | null> {
  const result = await db.execute(sql`
    UPDATE jobs SET
      status = 'running',
      worker_id = ${workerId},
      leased_until = now() + (${LEASE_MS} || ' milliseconds')::interval,
      started_at = coalesce(started_at, now()),
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = ${jobId}
      AND (status = 'queued' OR (status = 'running' AND leased_until IS NOT NULL AND leased_until < now()))
    RETURNING *
  `);
  const rows = ((result as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;
  return rows[0] ? toClaimedJob(rows[0]) : null;
}

/** Extend the lease on a job this worker still holds. */
export async function heartbeat(db: Db, jobId: string, workerId: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET leased_until = now() + (${LEASE_MS} || ' milliseconds')::interval, updated_at = now()
    WHERE id = ${jobId} AND worker_id = ${workerId} AND status = 'running'
  `);
}

/** Release the lease once a job reaches a terminal state. */
async function releaseLease(db: Db, jobId: string): Promise<void> {
  await db.update(jobs).set({ leasedUntil: null, workerId: null }).where(eq(jobs.id, jobId));
}

/** Dispatch a claimed job to its workflow, heartbeating the lease throughout. */
export async function runClaimedJob(deps: PipelineDeps, job: ClaimedJob, workerId: string): Promise<void> {
  const beat = setInterval(() => {
    void heartbeat(deps.db, job.id, workerId).catch(() => undefined);
  }, HEARTBEAT_MS);

  try {
    switch (job.kind) {
      case "generation":
        // These own their own terminal state: they mark the job failed and
        // refund the reservation on the way out.
        await runGenerationJob(deps, job.id);
        break;
      case "reroll":
        await runRerollJob(deps, job.id);
        break;
      case "publish": {
        // The queue row points at the publish_jobs record holding the details.
        const { publishJobId } = JSON.parse(job.detail ?? "{}") as { publishJobId?: string };
        if (!publishJobId) throw new Error(`Publish job ${job.id} has no publishJobId`);
        await runPublishJob(deps, publishJobId);
        await deps.db
          .update(jobs)
          .set({ status: "completed", finishedAt: new Date() })
          .where(eq(jobs.id, job.id));
        break;
      }
      default:
        // Unknown kinds must not spin forever in the queue.
        await deps.db
          .update(jobs)
          .set({ status: "failed", error: `No handler for job kind ${job.kind}`, finishedAt: new Date() })
          .where(eq(jobs.id, job.id));
    }
  } catch (err) {
    // A row left in `running` would be reclaimed on lease expiry and retried
    // forever. Workflows that already recorded failure are left alone; anything
    // else (publish, unexpected throws) is marked terminal here.
    await deps.db
      .update(jobs)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date()
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")))
      .catch(() => undefined);
    throw err;
  } finally {
    clearInterval(beat);
    await releaseLease(deps.db, job.id).catch(() => undefined);
  }
}

export interface WorkerOptions {
  /** Jobs run concurrently by this worker. Renders are heavy — keep it low. */
  concurrency?: number;
  /** Sleep between empty polls. */
  pollIntervalMs?: number;
  workerId?: string;
  /** Test hook: stop after the queue drains. */
  stopWhenDrained?: boolean;
}

export interface WorkerHandle {
  workerId: string;
  stop: () => Promise<void>;
  /** Resolves when the loop exits (drained in test mode, or stopped). */
  done: Promise<void>;
}

/**
 * Poll-and-claim worker loop. Runs in the standalone worker process
 * (apps/worker) and, in dev, inside the web process.
 */
export function startWorker(deps: PipelineDeps, options: WorkerOptions = {}): WorkerHandle {
  const workerId = options.workerId ?? newId("wrk");
  const concurrency = options.concurrency ?? Number(process.env.FAV_WORKER_CONCURRENCY ?? 2);
  const pollIntervalMs = options.pollIntervalMs ?? Number(process.env.FAV_WORKER_POLL_MS ?? 2000);
  let stopping = false;

  const loop = async (slot: number): Promise<void> => {
    while (!stopping) {
      let job: ClaimedJob | null = null;
      try {
        job = await claimNextJob(deps.db, `${workerId}:${slot}`);
      } catch (err) {
        console.error(JSON.stringify({ event: "job_claim_failed", workerId, error: String(err) }));
      }

      if (!job) {
        if (options.stopWhenDrained) return;
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }

      console.log(JSON.stringify({ event: "job_started", jobId: job.id, kind: job.kind, workerId, attempt: job.attempts }));
      const startedAt = Date.now();
      try {
        await runClaimedJob(deps, job, `${workerId}:${slot}`);
        console.log(
          JSON.stringify({ event: "job_finished", jobId: job.id, kind: job.kind, ms: Date.now() - startedAt })
        );
      } catch (err) {
        // The workflow has already recorded failure and refunded; log for ops.
        console.error(
          JSON.stringify({ event: "job_failed", jobId: job.id, kind: job.kind, error: String(err) })
        );
      }
    }
  };

  const done = Promise.all(Array.from({ length: concurrency }, (_, i) => loop(i))).then(() => undefined);

  return {
    workerId,
    done,
    stop: async () => {
      stopping = true;
      await done;
    }
  };
}

/** Requeue jobs whose worker died, without waiting for a claim (ops/visibility). */
export async function reclaimExpiredLeases(db: Db): Promise<{ reclaimed: number }> {
  const result = await db.execute(sql`
    UPDATE jobs
    SET status = 'queued', worker_id = NULL, leased_until = NULL, updated_at = now()
    WHERE status = 'running' AND leased_until IS NOT NULL AND leased_until < now()
    RETURNING id
  `);
  const rows = ((result as { rows?: unknown[] }).rows ?? []) as unknown[];
  if (rows.length > 0) {
    console.warn(JSON.stringify({ event: "leases_reclaimed", count: rows.length }));
  }
  return { reclaimed: rows.length };
}
