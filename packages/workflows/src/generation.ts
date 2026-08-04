import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { and, asc, eq } from "drizzle-orm";
import {
  buildCaptionCues,
  createLogger,
  dimensionsFor,
  estimateVideoCost,
  newId,
  videoRequestSchema,
  videoScriptSchema,
  COST_TABLE,
  SCENE_GENERATION_CONCURRENCY,
  type CaptionCue,
  type JobProgress,
  type VideoRequest,
  type VideoScript,
  type WordTimestamp
} from "@fav/core";
import {
  finalizeCredits,
  jobs,
  moderationDecisions,
  musicTracks,
  refundCredits,
  reserveCredits,
  scenes as scenesTable,
  videos
} from "@fav/db";
import {
  assetKeys,
  getAnalytics,
  getStreamingProvider,
  synthesizeMusicTrack,
  withFallback,
  type StorageProvider
} from "@fav/providers";
import type { RenderProps } from "@fav/render";
import type { PipelineDeps } from "./deps.js";

/** Non-retryable failures (moderation block, insufficient credits). */
export class TerminalJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalJobError";
  }
}

async function setProgress(deps: PipelineDeps, jobId: string, progress: JobProgress): Promise<void> {
  await deps.db
    .update(jobs)
    .set({
      stage: progress.stage,
      stageProgress: Math.round(progress.stageProgress),
      detail: progress.detail,
      updatedAt: new Date()
    })
    .where(eq(jobs.id, jobId));
}

async function setVideoStatus(
  deps: PipelineDeps,
  videoId: string,
  status: "queued" | "generating" | "rendering" | "completed" | "failed",
  extra: Partial<typeof videos.$inferInsert> = {}
): Promise<void> {
  await deps.db
    .update(videos)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(videos.id, videoId));
}

/** Turn a stored asset into a URL the renderer's headless browser can load. */
async function assetUrl(storage: StorageProvider, key: string, contentType: string): Promise<string> {
  const local = storage.localPath(key);
  if (local) {
    const data = await storage.get(key);
    return `data:${contentType};base64,${data.toString("base64")}`;
  }
  return storage.getSignedUrl(key, 3600);
}

/**
 * The end-to-end generation workflow (FAV-902):
 * reserve -> moderate -> script -> visuals -> voice -> transcribe -> captions -> render -> store -> finalize.
 *
 * Every step is idempotent keyed on domain state (FAV-903): a retried run skips
 * work whose artifacts already exist, and re-generation overwrites the same
 * storage keys — never duplicates. Terminal failure refunds the reservation (FAV-904).
 */
export async function runGenerationJob(deps: PipelineDeps, jobId: string): Promise<void> {
  const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === "completed") return; // idempotent re-entry
  const videoId = job.videoId;
  if (!videoId) throw new Error(`Job ${jobId} has no video`);

  const [video] = await deps.db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Video ${videoId} not found`);
  const request = videoRequestSchema.parse(video.request);

  // One trace id follows this video from enqueue through render (FAV-1601).
  const log = createLogger({
    traceId: job.traceId ?? undefined,
    jobId,
    videoId,
    orgId: job.orgId
  });
  const startedAt = Date.now();
  log.info("generation_started", { attempt: job.attempts, tier: request.tier });

  // Attempt counting belongs to the queue, which owns claiming and retries —
  // incrementing here too would double-count every run.
  await deps.db
    .update(jobs)
    .set({ status: "running", startedAt: job.startedAt ?? new Date() })
    .where(eq(jobs.id, jobId));

  try {
    // -- 1. Reserve credits (race-safe, idempotent per job) -----------------
    await setProgress(deps, jobId, { stage: "reserving_credits", stageProgress: 0 });
    const estimate = estimateVideoCost(request);
    await reserveCredits(deps.db, {
      orgId: job.orgId,
      jobId,
      videoId,
      amount: estimate.total,
      reason: `Video generation: ${video.topic.slice(0, 80)}`
    });
    await setVideoStatus(deps, videoId, "generating", { creditsEstimated: estimate.total });

    // -- 2. Moderate input (FAV-405) ---------------------------------------
    await setProgress(deps, jobId, { stage: "moderating", stageProgress: 0 });
    const verdict = await deps.moderation.moderate(video.topic);
    await deps.db.insert(moderationDecisions).values({
      id: newId("mod"),
      orgId: job.orgId,
      videoId,
      stage: "input",
      inputText: video.topic,
      verdict: verdict.verdict,
      categories: verdict.categories
    });
    if (verdict.verdict === "blocked") {
      throw new TerminalJobError(
        `This topic can't be generated (${verdict.categories.join(", ")}). Please choose a different topic.`
      );
    }

    // -- 3. Script (skip if already generated/edited) -----------------------
    await setProgress(deps, jobId, { stage: "scripting", stageProgress: 0 });
    let script: VideoScript;
    if (video.script) {
      script = videoScriptSchema.parse(video.script);
    } else {
      script = await deps.llm.generateScript({
        topic: video.topic,
        targetDurationSeconds: request.durationSeconds,
        tone: request.tone,
        visualStyle: request.visualStyle,
        language: request.language
      });
      await deps.db
        .update(videos)
        .set({ script, title: script.title, updatedAt: new Date() })
        .where(eq(videos.id, videoId));
    }

    // Output spot-check (FAV-1605): moderate the generated narration too; a
    // blocked script is terminal, a flagged one proceeds but is logged.
    const outputVerdict = await deps.moderation.moderate(
      script.scenes.map((s) => s.narration).join(" ")
    );
    if (outputVerdict.verdict !== "allowed") {
      await deps.db.insert(moderationDecisions).values({
        id: newId("mod"),
        orgId: job.orgId,
        videoId,
        stage: "output",
        inputText: script.title,
        verdict: outputVerdict.verdict,
        categories: outputVerdict.categories
      });
      if (outputVerdict.verdict === "blocked") {
        throw new TerminalJobError("The generated script violated content policy. Please try a different topic.");
      }
    }

    // Materialize scene rows (idempotent: keyed on video+index).
    for (const scene of script.scenes) {
      await deps.db
        .insert(scenesTable)
        .values({
          id: newId("scn"),
          videoId,
          index: scene.index,
          narration: scene.narration,
          visualPrompt: scene.visualPrompt,
          onScreenText: scene.onScreenText
        })
        .onConflictDoNothing({ target: [scenesTable.videoId, scenesTable.index] });
    }
    await setProgress(deps, jobId, { stage: "scripting", stageProgress: 100 });

    // -- 4. Visuals: parallel with a concurrency cap (FAV-504) --------------
    const sceneRows = await deps.db
      .select()
      .from(scenesTable)
      .where(eq(scenesTable.videoId, videoId))
      .orderBy(asc(scenesTable.index));

    let visualsDone = 0;
    let visualsCost = 0;
    const pending = sceneRows.filter((s) => !s.imageAssetKey && !s.clipAssetKey);
    visualsDone = sceneRows.length - pending.length;
    await setProgress(deps, jobId, {
      stage: "generating_visuals",
      stageProgress: (visualsDone / Math.max(1, sceneRows.length)) * 100
    });

    const queue = [...pending];
    const workers = Array.from({ length: Math.min(SCENE_GENERATION_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const scene = queue.shift();
        if (!scene) return;
        await deps.db
          .update(scenesTable)
          .set({ status: "generating" })
          .where(eq(scenesTable.id, scene.id));

        // max tier tries clips first, gracefully downgrading to stills (FAV-503).
        let clipStored = false;
        if (request.tier === "max") {
          const clip = await deps.visuals.generateClip({
            prompt: scene.visualPrompt,
            style: request.visualStyle,
            aspectRatio: request.aspectRatio,
            durationSeconds: 6,
            seed: scene.index
          });
          if (clip) {
            const key = assetKeys.sceneClip(videoId, scene.index, clip.extension);
            await deps.storage.put(key, clip.data, clip.contentType);
            await deps.db
              .update(scenesTable)
              .set({ clipAssetKey: key, status: "completed" })
              .where(eq(scenesTable.id, scene.id));
            visualsCost += clip.costCredits;
            clipStored = true;
          }
        }

        if (!clipStored) {
          // Primary -> fallback with circuit breakers (FAV-501/906).
          const image = await withFallback(
            {
              name: `visuals:${deps.visuals.name}`,
              fn: () =>
                deps.visuals.generateImage({
                  prompt: scene.visualPrompt,
                  style: request.visualStyle,
                  tier: request.tier,
                  aspectRatio: request.aspectRatio,
                  resolution: request.resolution,
                  seed: scene.index
                })
            },
            deps.visuals.name === deps.fallbackVisuals.name
              ? undefined
              : {
                  name: `visuals:${deps.fallbackVisuals.name}`,
                  fn: () =>
                    deps.fallbackVisuals.generateImage({
                      prompt: scene.visualPrompt,
                      style: request.visualStyle,
                      tier: request.tier,
                      aspectRatio: request.aspectRatio,
                      resolution: request.resolution,
                      seed: scene.index
                    })
                }
          );
          const key = assetKeys.sceneImage(videoId, scene.index, image.extension);
          await deps.storage.put(key, image.data, image.contentType);
          await deps.db
            .update(scenesTable)
            .set({ imageAssetKey: key, status: "completed" })
            .where(eq(scenesTable.id, scene.id));
          visualsCost += image.costCredits;
        }

        visualsDone++;
        await setProgress(deps, jobId, {
          stage: "generating_visuals",
          stageProgress: (visualsDone / sceneRows.length) * 100,
          detail: `Scene ${visualsDone}/${sceneRows.length}`
        });
      }
    });
    await Promise.all(workers);

    // -- 5. Voice (FAV-604): skip if narration already stored ---------------
    await setProgress(deps, jobId, { stage: "synthesizing_voice", stageProgress: 0 });
    const fullNarration = script.scenes.map((s) => s.narration).join(" ");
    let narrationKey = video.narrationAssetKey;
    let narrationDuration = video.durationSeconds ?? 0;
    let voiceCost = 0;
    let narrationContentType = "audio/wav";
    if (!narrationKey) {
      const speech = await deps.tts.synthesize({
        text: fullNarration,
        voiceId: request.voiceId ?? "voice_adam",
        language: request.language
      });
      narrationKey = assetKeys.narration(videoId, speech.extension);
      narrationContentType = speech.contentType;
      await deps.storage.put(narrationKey, speech.audio, speech.contentType);
      narrationDuration = speech.durationSeconds;
      voiceCost = speech.costCredits;
      await deps.db
        .update(videos)
        .set({ narrationAssetKey: narrationKey, durationSeconds: narrationDuration, updatedAt: new Date() })
        .where(eq(videos.id, videoId));
    }

    // -- 6. Transcribe the real audio (FAV-701) -----------------------------
    await setProgress(deps, jobId, { stage: "transcribing", stageProgress: 0 });
    const audioBuffer = await deps.storage.get(narrationKey);
    const words = await deps.transcription.transcribe({
      audio: audioBuffer,
      hintText: fullNarration,
      durationSeconds: narrationDuration > 0 ? narrationDuration : undefined
    });
    if (narrationDuration <= 0 && words.length > 0) {
      narrationDuration = words[words.length - 1]!.endSec + 0.4;
      await deps.db
        .update(videos)
        .set({ durationSeconds: narrationDuration, updatedAt: new Date() })
        .where(eq(videos.id, videoId));
    }

    // -- 7. Caption cues + scene timing (FAV-702) ---------------------------
    await setProgress(deps, jobId, { stage: "building_captions", stageProgress: 0 });
    const cues = buildCaptionCues(words);
    await deps.db
      .update(videos)
      .set({ captionCues: cues, updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    const sceneTimings = distributeSceneTimings(script, words, narrationDuration);
    for (const timing of sceneTimings) {
      await deps.db
        .update(scenesTable)
        .set({ audioStartSec: timing.startSec, audioEndSec: timing.endSec })
        .where(and(eq(scenesTable.videoId, videoId), eq(scenesTable.index, timing.index)));
    }

    // -- 8. Render (FAV-801/808) -------------------------------------------
    await setProgress(deps, jobId, { stage: "rendering", stageProgress: 0 });
    await setVideoStatus(deps, videoId, "rendering");
    const finalKey = assetKeys.finalVideo(videoId);
    const alreadyRendered = await deps.storage.exists(finalKey);
    if (!alreadyRendered) {
      const refreshedScenes = await deps.db
        .select()
        .from(scenesTable)
        .where(eq(scenesTable.videoId, videoId))
        .orderBy(asc(scenesTable.index));

      const { width, height } = dimensionsFor(request.aspectRatio, request.resolution);
      const renderScenes = await Promise.all(
        refreshedScenes.map(async (scene, i) => {
          const timing = sceneTimings[i] ?? { startSec: 0, endSec: narrationDuration };
          const imageUrl = scene.imageAssetKey
            ? await assetUrl(deps.storage, scene.imageAssetKey, "image/svg+xml")
            : "";
          const clipUrl = scene.clipAssetKey
            ? await assetUrl(deps.storage, scene.clipAssetKey, "video/mp4")
            : undefined;
          return {
            imageUrl,
            clipUrl,
            startSec: timing.startSec,
            endSec: timing.endSec,
            onScreenText: scene.onScreenText ?? undefined
          };
        })
      );

      // Background music (FAV-805): the mock library synthesizes its track on
      // first use so the keyless sandbox mixes real audio.
      let musicUrl: string | undefined;
      if (request.musicTrackId) {
        const [track] = await deps.db
          .select()
          .from(musicTracks)
          .where(eq(musicTracks.id, request.musicTrackId));
        if (track) {
          if (!(await deps.storage.exists(track.assetKey))) {
            const wav = synthesizeMusicTrack(track.mood, track.durationSeconds);
            await deps.storage.put(track.assetKey, wav, "audio/wav");
          }
          musicUrl = await assetUrl(deps.storage, track.assetKey, "audio/wav");
        }
      }

      const props: RenderProps = {
        scenes: renderScenes,
        audioUrl: await assetUrl(deps.storage, narrationKey, narrationContentType),
        musicUrl,
        cues: cues as CaptionCue[],
        captionStyle: request.captionStyle,
        transition: request.transition,
        width,
        height,
        fps: 30,
        durationSeconds: narrationDuration,
        watermark: request.watermark
      };

      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "fav-render-"));
      const outPath = path.join(tmpDir, "final.mp4");
      try {
        await deps.render({
          props,
          outPath,
          onProgress: (percent) => {
            void setProgress(deps, jobId, { stage: "rendering", stageProgress: percent });
          }
        });
        // -- 9. Store final -------------------------------------------------
        await setProgress(deps, jobId, { stage: "storing", stageProgress: 0 });
        const finalData = await readFile(outPath);
        await deps.storage.put(finalKey, finalData, "video/mp4");
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }

    // Streaming ingest (FAV-1002): Mux when configured; direct playback in dev.
    if (!video.playbackId) {
      const streaming = getStreamingProvider();
      const ingested = await streaming
        .ingest(await deps.storage.getSignedUrl(finalKey, 3600))
        .catch((err) => {
          console.warn(JSON.stringify({ event: "streaming_ingest_failed", videoId, error: String(err) }));
          return null;
        });
      if (ingested) {
        await deps.db
          .update(videos)
          .set({ playbackId: ingested.playbackId, updatedAt: new Date() })
          .where(eq(videos.id, videoId));
      }
    }

    // -- 10. Finalize credits (FAV-904) ------------------------------------
    await setProgress(deps, jobId, { stage: "finalizing", stageProgress: 0 });
    const actualCost = Math.min(
      estimate.total,
      COST_TABLE.scriptGeneration +
        visualsCost +
        voiceCost +
        COST_TABLE.transcription +
        COST_TABLE.renderBase[request.resolution]
    );
    const { charged } = await finalizeCredits(deps.db, { orgId: job.orgId, jobId, videoId, actualCost });

    await setVideoStatus(deps, videoId, "completed", {
      finalAssetKey: finalKey,
      creditsCharged: charged,
      completedAt: new Date()
    });
    await deps.db
      .update(jobs)
      .set({ status: "completed", stage: "finalizing", stageProgress: 100, finishedAt: new Date() })
      .where(eq(jobs.id, jobId));

    const elapsedMs = Date.now() - startedAt;
    log.info("generation_completed", { elapsedMs, charged, scenes: sceneRows.length });
    getAnalytics().capture({
      distinctId: video.createdByUserId ?? job.orgId,
      orgId: job.orgId,
      event: "video_generation_completed",
      properties: {
        videoId,
        elapsedMs,
        credits: charged,
        tier: request.tier,
        durationSeconds: narrationDuration,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("generation_failed", err, { elapsedMs: Date.now() - startedAt });
    getAnalytics().capture({
      distinctId: video.createdByUserId ?? job.orgId,
      orgId: job.orgId,
      event: "video_generation_failed",
      properties: { videoId, reason: message.slice(0, 200), terminal: err instanceof TerminalJobError }
    });
    // Terminal failure: mark failed + full refund (FAV-904/808).
    await refundCredits(deps.db, { orgId: job.orgId, jobId, videoId, reason: `Failed: ${message.slice(0, 200)}` });
    await setVideoStatus(deps, videoId, "failed", { errorMessage: message });
    await deps.db
      .update(jobs)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(jobs.id, jobId));
    throw err;
  }
}

/**
 * Assign each scene its slice of the narration timeline using the transcribed
 * word timestamps, split proportionally by scene word counts (FAV-702: timing
 * comes from the audio, not the script).
 */
export function distributeSceneTimings(
  script: VideoScript,
  words: WordTimestamp[],
  totalDuration: number
): Array<{ index: number; startSec: number; endSec: number }> {
  const counts = script.scenes.map((s) => s.narration.split(/\s+/).filter(Boolean).length);
  const timings: Array<{ index: number; startSec: number; endSec: number }> = [];
  let wordCursor = 0;
  let prevEnd = 0;
  for (let i = 0; i < script.scenes.length; i++) {
    const isLast = i === script.scenes.length - 1;
    const endWordIndex = isLast ? words.length : Math.min(words.length, wordCursor + (counts[i] ?? 0));
    const lastWord = words[endWordIndex - 1];
    const endSec = isLast ? totalDuration : lastWord ? lastWord.endSec : prevEnd;
    timings.push({ index: i, startSec: prevEnd, endSec: Math.max(endSec, prevEnd + 0.5) });
    prevEnd = timings[i]!.endSec;
    wordCursor = endWordIndex;
  }
  return timings;
}

/** Create the video + job rows and return ids — the enqueue side of FAV-902. */
export async function createGenerationJob(
  db: PipelineDeps["db"],
  args: { orgId: string; userId?: string; request: VideoRequest }
): Promise<{ videoId: string; jobId: string }> {
  const request = videoRequestSchema.parse(args.request);
  const videoId = newId("vid");
  await db.insert(videos).values({
    id: videoId,
    orgId: args.orgId,
    createdByUserId: args.userId,
    topic: request.topic,
    status: "queued",
    request
  });
  const { jobId } = await enqueueGenerationRun(db, { orgId: args.orgId, videoId });
  return { videoId, jobId };
}

/**
 * Enqueue a (re-)generation run for an existing video. Steps are idempotent on
 * domain state, so after scene edits or re-rolls only the invalidated
 * artifacts regenerate (FAV-404/1103 re-render path).
 */
export async function enqueueGenerationRun(
  db: PipelineDeps["db"],
  args: { orgId: string; videoId: string }
): Promise<{ jobId: string }> {
  const existing = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.videoId, args.videoId), eq(jobs.kind, "generation")));
  const jobId = newId("job");
  await db.insert(jobs).values({
    id: jobId,
    orgId: args.orgId,
    videoId: args.videoId,
    kind: "generation",
    status: "queued",
    idempotencyKey: `generation:${args.videoId}:${existing.length}`,
    traceId: newId("trc")
  });
  await db
    .update(videos)
    .set({ status: "queued", errorMessage: null, updatedAt: new Date() })
    .where(eq(videos.id, args.videoId));
  return { jobId };
}
