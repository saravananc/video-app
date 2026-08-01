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

/**
 * Dev schedulers (FAV-1402/1003). In production these run as external crons
 * against /api/autopilot/sweep and /api/admin/maintenance so they fire once
 * across the fleet rather than once per web instance — set
 * FAV_SCHEDULERS=0 there.
 */
declare global {
  var __favAutopilotTimer: ReturnType<typeof setInterval> | undefined;
  var __favMaintenanceTimer: ReturnType<typeof setInterval> | undefined;
}

const SCHEDULERS_DISABLED = () =>
  process.env.FAV_SCHEDULERS === "0" || process.env.FAV_AUTOPILOT_SCHEDULER === "0";

export function ensureSchedulers(): void {
  if (SCHEDULERS_DISABLED()) return;

  if (!globalThis.__favAutopilotTimer) {
    globalThis.__favAutopilotTimer = setInterval(() => {
      kick(`autopilot-sweep:${Date.now()}`, async () => {
        const { sweepDueAutopilotRules } = await import("@fav/workflows");
        await sweepDueAutopilotRules(defaultDeps(getDb()));
      });
    }, 60_000);
  }

  if (!globalThis.__favMaintenanceTimer) {
    // Hourly: retention is measured in days, so this is about not drifting.
    globalThis.__favMaintenanceTimer = setInterval(() => {
      kick(`maintenance:${Date.now()}`, async () => {
        const { runMaintenance } = await import("@fav/workflows");
        const { getStorageProvider } = await import("@fav/providers");
        await runMaintenance(getDb(), getStorageProvider());
      });
    }, 3600_000);
  }
}

