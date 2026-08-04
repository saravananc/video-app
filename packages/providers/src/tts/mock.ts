import { COST_TABLE } from "@fav/core";
import { encodeWav, SAMPLE_RATE } from "../audio/wav.js";
import { concatWav } from "../audio/concat.js";
import { chunkNarration, DEFAULT_CHUNK_CHARS } from "./chunking.js";
import type { TtsProvider, TtsResult } from "../types.js";

/** Per-word timing model shared with the mock transcriber so captions align exactly. */
export const MOCK_SECONDS_PER_WORD = 0.38;
export const MOCK_SENTENCE_PAUSE = 0.25;

export function mockWordTimings(text: string): Array<{ word: string; startSec: number; endSec: number }> {
  const words = text.split(/\s+/).filter(Boolean);
  const timings: Array<{ word: string; startSec: number; endSec: number }> = [];
  let t = 0.15; // small lead-in
  for (const word of words) {
    const start = t;
    const end = start + MOCK_SECONDS_PER_WORD;
    timings.push({ word, startSec: round3(start), endSec: round3(end) });
    t = end + (/[.!?]$/.test(word) ? MOCK_SENTENCE_PAUSE : 0.02);
  }
  return timings;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Synthesizes speech-shaped audio: one soft formant burst per word at a pitch
 * derived from the word + voice, silence in the gaps. Not intelligible, but the
 * rhythm matches the caption timing exactly, which is what the render pipeline
 * needs to be judged (FAV-604: precise duration recorded).
 */
export class MockTtsProvider implements TtsProvider {
  readonly name = "mock";

  /**
   * Chunks like the real provider does (FAV-604) so the stitching path is
   * exercised in dev, then concatenates the WAV segments.
   */
  async synthesize(args: { text: string; voiceId: string; language: string }): Promise<TtsResult> {
    const chunks = chunkNarration(args.text, DEFAULT_CHUNK_CHARS);
    if (chunks.length > 1) {
      const parts = await Promise.all(chunks.map((chunk) => this.synthesizeOne(chunk, args.voiceId)));
      const audio = concatWav(parts.map((p) => p.audio));
      return {
        audio,
        contentType: "audio/wav",
        extension: "wav",
        durationSeconds: parts.reduce((sum, p) => sum + p.durationSeconds, 0),
        costCredits: Math.max(1, Math.ceil(args.text.length / 1000) * COST_TABLE.ttsPerThousandChars)
      };
    }
    return this.synthesizeOne(args.text, args.voiceId);
  }

  private async synthesizeOne(text: string, voiceId: string): Promise<TtsResult> {
    const timings = mockWordTimings(text);
    const last = timings[timings.length - 1];
    const durationSeconds = (last ? last.endSec : 0.5) + 0.35; // tail pad
    const total = Math.ceil(durationSeconds * SAMPLE_RATE);
    const samples = new Float32Array(total);
    const voiceBase = 120 + (hash(voiceId) % 120); // per-voice pitch

    for (const { word, startSec, endSec } of timings) {
      const f0 = voiceBase + (hash(word) % 90);
      const start = Math.floor(startSec * SAMPLE_RATE);
      const end = Math.min(total, Math.floor(endSec * SAMPLE_RATE));
      const len = end - start;
      for (let i = 0; i < len; i++) {
        const tSec = i / SAMPLE_RATE;
        // Attack/decay envelope per word so it pulses like speech.
        const env = Math.sin((Math.PI * i) / len) ** 1.5;
        const sample =
          0.22 * Math.sin(2 * Math.PI * f0 * tSec) +
          0.08 * Math.sin(2 * Math.PI * f0 * 2.1 * tSec) +
          0.04 * Math.sin(2 * Math.PI * f0 * 3.3 * tSec);
        samples[start + i] = sample * env * 0.6;
      }
    }

    const audio = encodeWav(samples);
    return {
      audio,
      contentType: "audio/wav",
      extension: "wav",
      durationSeconds,
      costCredits: Math.max(1, Math.ceil(text.length / 1000) * COST_TABLE.ttsPerThousandChars)
    };
  }

  async listVoices() {
    return [
      { id: "voice_adam", name: "Adam", language: "en", previewText: "Deep, confident narrator" },
      { id: "voice_bella", name: "Bella", language: "en", previewText: "Warm, engaging storyteller" },
      { id: "voice_josh", name: "Josh", language: "en", previewText: "Energetic, youthful" },
      { id: "voice_elena", name: "Elena", language: "es", previewText: "Narración clara en español" },
      { id: "voice_yuki", name: "Yuki", language: "ja", previewText: "落ち着いた日本語ナレーション" }
    ];
  }

  async cloneVoice(args: { name: string; sample: Buffer }): Promise<{ providerVoiceId: string }> {
    return { providerVoiceId: `mockclone_${hash(args.name + args.sample.length)}` };
  }
}
