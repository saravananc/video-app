import { getDb } from "@fav/db";
import { defaultDeps, startWorker, type WorkerHandle } from "@fav/workflows";

/**
 * Job execution (FAV-901/807).
 *
 * Jobs are enqueued by writing a row to the jobs table — that write *is* the
 * durable handoff, so nothing is lost if the process dies between the HTTP
 * response and the work starting. Execution belongs to workers that claim
 * from the queue.
 *
 * In production run `apps/worker` as a separate autoscaling pool and set
 * FAV_EMBEDDED_WORKER=0 so the web tier only enqueues. For a single-process
 * dev setup, the web server hosts a worker itself.
 */

declare global {
  var __favEmbeddedWorker: WorkerHandle | undefined;
  var __favAutopilotTimer: ReturnType<typeof setInterval> | undefined;
  var __favMaintenanceTimer: ReturnType<typeof setInterval> | undefined;
}

function embeddedWorkerEnabled(): boolean {
  return process.env.FAV_EMBEDDED_WORKER !== "0";
}

function schedulersEnabled(): boolean {
  return process.env.FAV_SCHEDULERS !== "0" && process.env.FAV_AUTOPILOT_SCHEDULER !== "0";
}

/**
 * Start the in-process worker and dev schedulers once per server process.
 * Safe to call on every request — subsequent calls are no-ops.
 */
export function ensureSchedulers(): void {
  if (embeddedWorkerEnabled() && !globalThis.__favEmbeddedWorker) {
    globalThis.__favEmbeddedWorker = startWorker(defaultDeps(getDb()), {
      concurrency: Number(process.env.FAV_WORKER_CONCURRENCY ?? 2)
    });
    console.log(
      JSON.stringify({ event: "embedded_worker_started", workerId: globalThis.__favEmbeddedWorker.workerId })
    );
  }

  if (!schedulersEnabled()) return;

  if (!globalThis.__favAutopilotTimer) {
    globalThis.__favAutopilotTimer = setInterval(() => {
      void (async () => {
        const { sweepDueAutopilotRules } = await import("@fav/workflows");
        await sweepDueAutopilotRules(defaultDeps(getDb()));
      })().catch((err) => console.error(JSON.stringify({ event: "autopilot_sweep_failed", error: String(err) })));
    }, 60_000);
  }

  if (!globalThis.__favMaintenanceTimer) {
    // Hourly: retention is measured in days, so this is about not drifting.
    globalThis.__favMaintenanceTimer = setInterval(() => {
      void (async () => {
        const { runMaintenance } = await import("@fav/workflows");
        const { getStorageProvider } = await import("@fav/providers");
        await runMaintenance(getDb(), getStorageProvider());
      })().catch((err) => console.error(JSON.stringify({ event: "maintenance_failed", error: String(err) })));
    }, 3600_000);
  }
}

/**
 * Nudge the local worker to pick up newly enqueued work immediately instead of
 * waiting out its poll interval. Purely a latency optimization: the job is
 * already durably queued, and any worker in the fleet may run it.
 */
export function kickGenerationJob(_jobId: string): void {
  ensureSchedulers();
}

export function kickRerollJob(_jobId: string): void {
  ensureSchedulers();
}

export function kickPublishJob(_publishJobId: string): void {
  ensureSchedulers();
}
