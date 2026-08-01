import { and, eq, isNotNull, lte } from "drizzle-orm";
import { newId, videoRequestSchema } from "@fav/core";
import { autopilotRules, autopilotRuns, socialAccounts, videos } from "@fav/db";
import type { Platform } from "@fav/providers";
import type { PipelineDeps } from "./deps.js";
import { createGenerationJob, runGenerationJob } from "./generation.js";
import { createPublishJob, runPublishJob } from "./publish.js";

/**
 * Cadence grammar (FAV-1401/1402): "daily", "weekly", "every:<n>h", "every:<n>d".
 * Returns the next run strictly after `from`.
 */
export function computeNextRun(cadence: string, from: Date): Date {
  const ms = (() => {
    if (cadence === "daily") return 24 * 3600_000;
    if (cadence === "weekly") return 7 * 24 * 3600_000;
    const every = /^every:(\d+)([hd])$/.exec(cadence);
    if (every) {
      const n = Number(every[1]);
      return every[2] === "h" ? n * 3600_000 : n * 24 * 3600_000;
    }
    throw new Error(`Unknown cadence: ${cadence}`);
  })();
  return new Date(from.getTime() + ms);
}

/** How many recent topics to remember for variation (FAV-1404 originality). */
const TOPIC_MEMORY = 20;

/**
 * Execute one autopilot slot (FAV-1403): fresh idea (avoiding recent topics),
 * full generation pipeline, then publish — or hold for editorial review when
 * the rule requires it (FAV-1404 review gate).
 */
export async function runAutopilotRule(deps: PipelineDeps, ruleId: string): Promise<{ runId: string }> {
  const db = deps.db;
  const [rule] = await db.select().from(autopilotRules).where(eq(autopilotRules.id, ruleId));
  if (!rule) throw new Error(`Autopilot rule ${ruleId} not found`);

  const runId = newId("run");
  await db.insert(autopilotRuns).values({ id: runId, ruleId, orgId: rule.orgId, status: "running" });

  try {
    // Originality: steer the idea away from everything recently used (FAV-1404).
    const avoid = rule.recentTopics ?? [];
    const ideaTopic = await deps.llm.generateIdea(rule.niche, avoid);
    await db.update(autopilotRuns).set({ ideaTopic }).where(eq(autopilotRuns.id, runId));

    const request = videoRequestSchema.parse({
      ...(typeof rule.videoDefaults === "object" && rule.videoDefaults !== null ? rule.videoDefaults : {}),
      topic: ideaTopic
    });
    const { videoId, jobId } = await createGenerationJob(db, { orgId: rule.orgId, request });
    await db.update(autopilotRuns).set({ videoId }).where(eq(autopilotRuns.id, runId));
    await runGenerationJob(deps, jobId);

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    const creditsSpent = video?.creditsCharged ?? null;

    // Remember the topic so future runs vary (FAV-1404).
    await db
      .update(autopilotRules)
      .set({
        recentTopics: [...avoid, ideaTopic].slice(-TOPIC_MEMORY),
        lastRunAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(autopilotRules.id, ruleId));

    if (rule.requiresReview) {
      // Editorial gate: generated but not published until a human approves.
      await db
        .update(autopilotRuns)
        .set({ status: "awaiting_review", creditsSpent, finishedAt: new Date() })
        .where(eq(autopilotRuns.id, runId));
      return { runId };
    }

    if (rule.socialAccountId) {
      const [account] = await db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.id, rule.socialAccountId));
      if (account && account.status === "connected" && video) {
        const { publishJobId } = await createPublishJob(db, {
          orgId: rule.orgId,
          videoId,
          socialAccountId: account.id,
          platform: account.platform as Platform,
          title: video.title
        });
        await db.update(autopilotRuns).set({ publishJobId }).where(eq(autopilotRuns.id, runId));
        await runPublishJob(deps, publishJobId);
      }
    }

    await db
      .update(autopilotRuns)
      .set({ status: "completed", creditsSpent, finishedAt: new Date() })
      .where(eq(autopilotRuns.id, runId));
    return { runId };
  } catch (err) {
    // Failures alert the owner (FAV-1403 AC): recorded on the run + ops log.
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "autopilot_run_failed", ruleId, runId, error: message }));
    await db
      .update(autopilotRuns)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(autopilotRuns.id, runId));
    throw err;
  }
}

/**
 * Scheduler sweep (FAV-1402): fires every due rule, advances next_run_at, and
 * handles missed runs by scheduling from *now* (no pile-up of back-runs).
 */
export async function sweepDueAutopilotRules(deps: PipelineDeps): Promise<{ fired: string[] }> {
  const db = deps.db;
  const now = new Date();
  const due = await db
    .select()
    .from(autopilotRules)
    .where(and(eq(autopilotRules.enabled, true), isNotNull(autopilotRules.nextRunAt), lte(autopilotRules.nextRunAt, now)));

  const fired: string[] = [];
  for (const rule of due) {
    // Advance the schedule first so a crash can't double-fire the slot.
    await db
      .update(autopilotRules)
      .set({ nextRunAt: computeNextRun(rule.cadence, now), updatedAt: new Date() })
      .where(eq(autopilotRules.id, rule.id));
    try {
      const { runId } = await runAutopilotRule(deps, rule.id);
      fired.push(runId);
    } catch {
      // Recorded on the run row; the sweep continues with other rules.
    }
  }
  return { fired };
}
