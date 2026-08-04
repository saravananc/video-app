import * as Sentry from "@sentry/node";
import { setErrorReporter, logger } from "@fav/core";
import { getDb, runMigrations } from "@fav/db";
import { getAnalytics, getStorageProvider } from "@fav/providers";
import {
  defaultDeps,
  reclaimExpiredLeases,
  runMaintenance,
  startWorker,
  sweepDueAutopilotRules
} from "@fav/workflows";

/**
 * Standalone job worker (FAV-807/901).
 *
 * Runs the generation/reroll/publish pipelines isolated from the web tier so
 * CPU-heavy renders never contend with request serving, and so the pool can
 * autoscale on queue depth independently. Multiple replicas are safe: claims
 * use FOR UPDATE SKIP LOCKED and each job is leased to exactly one worker.
 *
 *   FAV_WORKER_CONCURRENCY  jobs in flight per worker (default 2)
 *   FAV_WORKER_POLL_MS      idle poll interval (default 2000)
 *   FAV_JOB_LEASE_MS        lease duration; heartbeat renews at a third of it
 *   FAV_WORKER_SCHEDULERS   "1" to also run autopilot + maintenance sweeps
 */
/** Error tracking for the worker tier (FAV-107); no-op without a DSN. */
function initSentry(): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false
  });
  // Structured-log errors carry their trace/job ids into Sentry (FAV-1601).
  setErrorReporter((error, context) => {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined) scope.setTag(key, String(value));
      }
      Sentry.captureException(error);
    });
  });
}

async function main(): Promise<void> {
  // PGlite is an embedded single-writer database: a separate worker process
  // gets its own instance and never sees the web tier's writes, so jobs would
  // appear to hang forever. Refuse to start rather than fail silently.
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is required: the standalone worker needs a shared Postgres. " +
        "Without it the app falls back to embedded PGlite, which cannot be shared " +
        "across processes — run the web server with FAV_EMBEDDED_WORKER=1 instead."
    );
    process.exit(1);
  }

  initSentry();
  await runMigrations();
  const db = getDb();
  const deps = defaultDeps(db);

  // Anything left running by a worker that died before this process started.
  await reclaimExpiredLeases(db);

  const worker = startWorker(deps);
  console.log(
    JSON.stringify({
      event: "worker_started",
      workerId: worker.workerId,
      concurrency: Number(process.env.FAV_WORKER_CONCURRENCY ?? 2)
    })
  );

  // Exactly one replica should own the schedulers; the rest just process jobs.
  const timers: Array<ReturnType<typeof setInterval>> = [];
  if (process.env.FAV_WORKER_SCHEDULERS === "1") {
    timers.push(
      setInterval(() => {
        void sweepDueAutopilotRules(deps).catch((err) =>
          console.error(JSON.stringify({ event: "autopilot_sweep_failed", error: String(err) }))
        );
      }, 60_000),
      setInterval(() => {
        void runMaintenance(db, getStorageProvider()).catch((err) =>
          console.error(JSON.stringify({ event: "maintenance_failed", error: String(err) }))
        );
      }, 3600_000)
    );
    console.log(JSON.stringify({ event: "worker_schedulers_enabled" }));
  }

  // Graceful shutdown: stop claiming, let in-flight jobs finish. Anything still
  // running when the deadline passes is reclaimed by another worker via lease.
  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ event: "worker_stopping", signal }));
    for (const timer of timers) clearInterval(timer);
    const forced = setTimeout(() => {
      console.warn(JSON.stringify({ event: "worker_force_exit" }));
      process.exit(1);
    }, 30_000);
    await worker.stop();
    clearTimeout(forced);
    // Drain buffered telemetry before the process goes away.
    await getAnalytics().shutdown().catch(() => undefined);
    if (process.env.SENTRY_DSN) await Sentry.flush(2000).catch(() => undefined);
    logger.info("worker_stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await worker.done;
}

main().catch((err) => {
  console.error(JSON.stringify({ event: "worker_crashed", error: String(err) }));
  process.exit(1);
});
