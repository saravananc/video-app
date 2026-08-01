import type { WordTimestamp } from "@fav/core";
import type { TranscriptionProvider } from "../types.js";

/**
 * Real adapter: OpenAI Whisper with word-level timestamps (FAV-701).
 * The synthesized audio is transcribed — script timing is never trusted.
 */
export class WhisperTranscriptionProvider implements TranscriptionProvider {
  readonly name = "openai-whisper";

  constructor(private readonly apiKey: string) {}

  async transcribe(args: { audio: Buffer; hintText?: string }): Promise<WordTimestamp[]> {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(args.audio)], { type: "audio/wav" }), "narration.wav");
    form.set("model", "whisper-1");
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form
    });
    if (!res.ok) throw new Error(`Whisper HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { words?: Array<{ word: string; start: number; end: number }> };
    return (body.words ?? []).map((w) => ({
      word: w.word.trim(),
      startSec: w.start,
      endSec: w.end
    }));
  }
}
