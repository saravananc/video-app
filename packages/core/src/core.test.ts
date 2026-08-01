import { describe, expect, it } from "vitest";
import { buildCaptionCues, type WordTimestamp } from "./schemas/captions.js";
import { estimateVideoCost } from "./credits.js";
import { videoRequestSchema, dimensionsFor } from "./schemas/video.js";
import { sceneCountForDuration } from "./constants.js";
import { overallPercent } from "./progress.js";

function words(text: string, secPerWord = 0.4): WordTimestamp[] {
  return text.split(" ").map((word, i) => ({
    word,
    startSec: i * secPerWord,
    endSec: (i + 1) * secPerWord
  }));
}

describe("caption cues (FAV-702)", () => {
  it("groups words into readable chunks", () => {
    const cues = buildCaptionCues(words("one two three four five six seven eight nine ten"));
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.words.length).toBeLessThanOrEqual(5);
      expect(cue.endSec).toBeGreaterThan(cue.startSec);
    }
  });

  it("breaks cues at sentence boundaries", () => {
    const cues = buildCaptionCues(words("Hello there. General Kenobi you are bold"));
    expect(cues[0]!.text).toBe("Hello there.");
  });

  it("timing covers the full word span in order", () => {
    const input = words("a b c d e f g h i j k l");
    const cues = buildCaptionCues(input);
    expect(cues[0]!.startSec).toBe(input[0]!.startSec);
    expect(cues[cues.length - 1]!.endSec).toBe(input[input.length - 1]!.endSec);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.startSec).toBeGreaterThanOrEqual(cues[i - 1]!.endSec);
    }
  });
});

describe("cost estimator (FAV-1207 / FAV-1102)", () => {
  const base = videoRequestSchema.parse({ topic: "the history of coffee" });

  it("prices a default video", () => {
    const cost = estimateVideoCost(base);
    expect(cost.total).toBe(cost.script + cost.visuals + cost.voice + cost.captions + cost.render);
    expect(cost.total).toBeGreaterThan(0);
  });

  it("premium tier costs more than basic; max meters per second (FAV-503)", () => {
    const basic = estimateVideoCost({ ...base, tier: "basic" });
    const premium = estimateVideoCost({ ...base, tier: "premium" });
    const max = estimateVideoCost({ ...base, tier: "max" });
    expect(premium.total).toBeGreaterThan(basic.total);
    expect(max.visuals).toBe(base.durationSeconds * 4);
  });

  it("4k render is metered above 1080p (FAV-806)", () => {
    const hd = estimateVideoCost({ ...base, resolution: "1080p" });
    const uhd = estimateVideoCost({ ...base, resolution: "4k" });
    expect(uhd.render).toBeGreaterThan(hd.render);
  });
});

describe("video config", () => {
  it("scene count maps to duration (FAV-402 AC)", () => {
    expect(sceneCountForDuration(60)).toBe(8);
    expect(sceneCountForDuration(15)).toBeGreaterThanOrEqual(3);
    expect(sceneCountForDuration(600)).toBeLessThanOrEqual(30);
  });

  it("dimensions honor aspect + resolution", () => {
    expect(dimensionsFor("9:16", "1080p")).toEqual({ width: 1080, height: 1920 });
    expect(dimensionsFor("16:9", "4k")).toEqual({ width: 3840, height: 2160 });
  });
});

describe("progress model (FAV-905)", () => {
  it("percent is monotonic across stages", () => {
    const early = overallPercent({ stage: "scripting", stageProgress: 100 });
    const later = overallPercent({ stage: "rendering", stageProgress: 0 });
    expect(later).toBeGreaterThan(early);
    expect(overallPercent({ stage: "finalizing", stageProgress: 100 })).toBe(100);
  });
});
