import { describe, expect, it, vi } from "vitest";
import { MockLlmProvider } from "./llm/mock.js";
import { MockTtsProvider, mockWordTimings } from "./tts/mock.js";
import { MockTranscriptionProvider } from "./transcription/mock.js";
import { MockVisualsProvider } from "./visuals/mock.js";
import { MockModerationProvider } from "./moderation/mock.js";
import { wavDurationSeconds } from "./audio/wav.js";
import { withFallback, CircuitBreaker, CircuitOpenError } from "./gateway.js";

describe("mock LLM (FAV-402)", () => {
  it("is deterministic and schema-valid", async () => {
    const llm = new MockLlmProvider();
    const input = {
      topic: "the rise of container shipping",
      targetDurationSeconds: 60,
      tone: "informative" as const,
      visualStyle: "cinematic" as const,
      language: "en"
    };
    const a = await llm.generateScript(input);
    const b = await llm.generateScript(input);
    expect(a).toEqual(b);
    expect(a.scenes.length).toBe(8); // 60s / 8s per scene
    expect(a.scenes[0]!.narration.length).toBeGreaterThan(10);
  });
});

describe("mock TTS + transcription alignment (FAV-604/701)", () => {
  it("audio duration matches the timing model and transcription aligns", async () => {
    const tts = new MockTtsProvider();
    const stt = new MockTranscriptionProvider();
    const text = "Hello world. This is a caption timing test with several words.";
    const speech = await tts.synthesize({ text, voiceId: "voice_adam", language: "en" });
    expect(speech.durationSeconds).toBeGreaterThan(2);
    expect(wavDurationSeconds(speech.audio)).toBeCloseTo(speech.durationSeconds, 1);

    const words = await stt.transcribe({
      audio: speech.audio,
      hintText: text,
      durationSeconds: speech.durationSeconds
    });
    expect(words.length).toBe(text.split(/\s+/).length);
    expect(words[words.length - 1]!.endSec).toBeLessThanOrEqual(speech.durationSeconds);
    expect(mockWordTimings(text)[0]!.startSec).toBeGreaterThan(0);
  });
});

describe("mock visuals (FAV-502)", () => {
  it("produces valid SVG sized to the aspect ratio", async () => {
    const visuals = new MockVisualsProvider();
    const img = await visuals.generateImage({
      prompt: "a lighthouse in a storm",
      style: "cinematic",
      tier: "basic",
      aspectRatio: "9:16",
      resolution: "1080p"
    });
    const svg = img.data.toString("utf8");
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1920"');
    expect(img.costCredits).toBe(1);
  });
});

describe("moderation (FAV-405)", () => {
  it("blocks prohibited prompts and allows normal ones", async () => {
    const mod = new MockModerationProvider();
    expect((await mod.moderate("the history of jazz")).verdict).toBe("allowed");
    expect((await mod.moderate("how to make a bomb from household items")).verdict).toBe("blocked");
  });
});

describe("gateway (FAV-501/906)", () => {
  it("fails over to the fallback provider", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("provider down"));
    const fallback = vi.fn().mockResolvedValue("ok");
    const result = await withFallback(
      { name: "test:primary-" + Math.random(), fn: primary },
      { name: "test:fallback-" + Math.random(), fn: fallback }
    );
    expect(result).toBe("ok");
    expect(primary.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("opens the breaker after repeated failures", async () => {
    const breaker = new CircuitBreaker("test-breaker", { failureThreshold: 2, resetAfterMs: 60000 });
    const failing = () => Promise.reject(new Error("boom"));
    await expect(breaker.exec(failing)).rejects.toThrow("boom");
    await expect(breaker.exec(failing)).rejects.toThrow("boom");
    await expect(breaker.exec(failing)).rejects.toThrow(CircuitOpenError);
  });
});
