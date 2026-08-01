import type { WordTimestamp } from "@fav/core";
import { mockWordTimings } from "../tts/mock.js";
import { wavDurationSeconds } from "../audio/wav.js";
import type { TranscriptionProvider } from "../types.js";

/**
 * Mock transcriber: reproduces the exact timing model the mock TTS used, scaled
 * to the real audio duration — so word timestamps always align with the audio,
 * mirroring what Whisper guarantees on real narration (FAV-701: run on final audio).
 */
export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = "mock";

  async transcribe(args: {
    audio: Buffer;
    hintText?: string;
    durationSeconds?: number;
  }): Promise<WordTimestamp[]> {
    if (!args.hintText) throw new Error("Mock transcription requires hintText (the narration script)");
    const timings = mockWordTimings(args.hintText);
    if (timings.length === 0) return [];

    // Scale to the actual audio length when it differs from the model.
    let audioDuration = args.durationSeconds;
    if (!audioDuration && args.audio.length > 44 && args.audio.toString("ascii", 0, 4) === "RIFF") {
      audioDuration = wavDurationSeconds(args.audio);
    }
    const modelEnd = timings[timings.length - 1]!.endSec + 0.35;
    const scale = audioDuration && audioDuration > 0 ? audioDuration / modelEnd : 1;

    return timings.map((t) => ({
      word: t.word,
      startSec: Math.round(t.startSec * scale * 1000) / 1000,
      endSec: Math.round(t.endSec * scale * 1000) / 1000
    }));
  }
}
