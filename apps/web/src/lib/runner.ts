import { getDb } from "@fav/db";
import { defaultDeps, runGenerationJob } from "@fav/workflows";

/**
 * In-process job runner: fire-and-forget with error containment. The workflow
 * itself persists all state (progress, refunds, failure) so the HTTP response
 * never waits on generation. Swappable for Inngest/queue workers in production
 * without touching the pipeline (plan decision).
 */
const running = new Set<string>();

export function kickGenerationJob(jobId: string): void {
  if (running.has(jobId)) return;
  running.add(jobId);
  const deps = defaultDeps(getDb());
  void runGenerationJob(deps, jobId)
    .catch((err) => {
      console.error(JSON.stringify({ event: "job_failed", jobId, error: String(err) }));
    })
    .finally(() => {
      running.delete(jobId);
    });
}
