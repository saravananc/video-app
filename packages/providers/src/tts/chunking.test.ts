import { describe, expect, it } from "vitest";
import { chunkNarration } from "./chunking.js";
import { concatWav } from "../audio/concat.js";
import { wavDurationSeconds } from "../audio/wav.js";
import { MockTtsProvider } from "./mock.js";

describe("narration chunking (FAV-604)", () => {
  it("leaves short text as a single chunk", () => {
    expect(chunkNarration("A short line.", 4000)).toEqual(["A short line."]);
    expect(chunkNarration("", 4000)).toEqual([]);
  });

  it("splits long text at sentence boundaries, under the limit", () => {
    const sentence = "This is a sentence of a reasonably typical length for narration. ";
    const text = sentence.repeat(200); // ~13k chars
    const chunks = chunkNarration(text, 1000);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
      // Every chunk ends a sentence — no mid-sentence cuts.
      expect(chunk.trim()).toMatch(/[.!?]$/);
    }
  });

  it("preserves the full text across chunks", () => {
    const text = "First one. Second one! Third one? Fourth one. ".repeat(60);
    const chunks = chunkNarration(text, 300);
    const rejoined = chunks.join(" ").replace(/\s+/g, " ").trim();
    expect(rejoined).toBe(text.replace(/\s+/g, " ").trim());
  });

  it("hard-splits a sentence longer than the limit rather than dropping it", () => {
    const long = `${"word ".repeat(400)}.`;
    const chunks = chunkNarration(long, 200);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("word word");
  });

  it("handles a single token longer than the limit", () => {
    const chunks = chunkNarration("a".repeat(500), 100);
    expect(chunks.length).toBe(5);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join("")).toBe("a".repeat(500));
  });
});

describe("chunked synthesis end to end", () => {
  it("stitches chunks into one audio stream with the summed duration", async () => {
    const tts = new MockTtsProvider();
    // Comfortably over the 4000-char default so chunking actually engages.
    const script = "The narration continues with another complete sentence here. ".repeat(120);
    expect(script.length).toBeGreaterThan(4000);

    const result = await tts.synthesize({ text: script, voiceId: "voice_adam", language: "en" });

    expect(result.contentType).toBe("audio/wav");
    // The stitched WAV's real duration matches what was reported.
    expect(wavDurationSeconds(result.audio)).toBeCloseTo(result.durationSeconds, 1);
    expect(result.durationSeconds).toBeGreaterThan(60);
  });

  it("concatWav joins buffers and rejects mismatched input", async () => {
    const tts = new MockTtsProvider();
    const a = await tts.synthesize({ text: "First part here.", voiceId: "voice_adam", language: "en" });
    const b = await tts.synthesize({ text: "Second part here.", voiceId: "voice_adam", language: "en" });

    const joined = concatWav([a.audio, b.audio]);
    expect(wavDurationSeconds(joined)).toBeCloseTo(a.durationSeconds + b.durationSeconds, 1);
    expect(concatWav([a.audio])).toBe(a.audio);
    expect(() => concatWav([a.audio, Buffer.from("not a wav")])).toThrow(/non-WAV/);
  });
});
