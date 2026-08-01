import { getDb } from "@fav/db";
import { defaultDeps, runGenerationJob, runPublishJob, runRerollJob } from "@fav/workflows";

/**
 * In-process job runner: fire-and-forget with error containment. The workflows
 * persist all state (progress, refunds, failure) so HTTP responses never wait
 * on generation. Swappable for Inngest/queue workers in production without
 * touching the pipelines (plan decision).
 */
const running = new Set<string>();

function kick(key: string, run: () => Promise<void>): void {
  if (running.has(key)) return;
  running.add(key);
  void run()
    .catch((err) => {
      console.error(JSON.stringify({ event: "job_failed", key, error: String(err) }));
    })
    .finally(() => {
      running.delete(key);
    });
}

export function kickGenerationJob(jobId: string): void {
  kick(`gen:${jobId}`, () => runGenerationJob(defaultDeps(getDb()), jobId));
}

export function kickRerollJob(jobId: string): void {
  kick(`reroll:${jobId}`, () => runRerollJob(defaultDeps(getDb()), jobId));
}

export function kickPublishJob(publishJobId: string): void {
  kick(`pub:${publishJobId}`, () => runPublishJob(defaultDeps(getDb()), publishJobId));
}

// Autopilot scheduler heartbeat (FAV-1402): a 60s in-process sweep in dev;
// production replaces this with a cron/scheduled worker hitting the same sweep.
declare global {
  var __favAutopilotTimer: ReturnType<typeof setInterval> | undefined;
}

export function ensureAutopilotScheduler(): void {
  if (globalThis.__favAutopilotTimer || process.env.FAV_AUTOPILOT_SCHEDULER === "0") return;
  globalThis.__favAutopilotTimer = setInterval(() => {
    kick(`autopilot-sweep:${Date.now()}`, async () => {
      const { sweepDueAutopilotRules } = await import("@fav/workflows");
      await sweepDueAutopilotRules(defaultDeps(getDb()));
    });
  }, 60_000);
}

