import { COST_TABLE } from "@fav/core";
import type { TtsProvider, TtsResult } from "../types.js";
import { chunkNarration, DEFAULT_CHUNK_CHARS } from "./chunking.js";

const BASE = "https://api.elevenlabs.io/v1";
const MODEL = process.env.FAV_ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
const MAX_ATTEMPTS = 3;

/** Real adapter for ElevenLabs TTS (FAV-601): model/voice selection + retries. */
export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = "elevenlabs";

  constructor(private readonly apiKey: string) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt * (0.5 + Math.random())));
      try {
        const res = await fetch(`${BASE}${path}`, {
          ...init,
          headers: { "xi-api-key": this.apiKey, ...(init?.headers ?? {}) }
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`ElevenLabs HTTP ${res.status}`);
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async synthesizeChunk(text: string, voiceId: string, previous?: string, next?: string): Promise<Buffer> {
    const res = await this.request(`/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        // Neighbouring text keeps prosody continuous across a chunk boundary,
        // so a stitched long script doesn't sound like separate takes.
        ...(previous ? { previous_text: previous.slice(-500) } : {}),
        ...(next ? { next_text: next.slice(0, 500) } : {})
      })
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Long scripts are chunked at sentence boundaries and stitched (FAV-604). */
  async synthesize(args: { text: string; voiceId: string; language: string }): Promise<TtsResult> {
    const chunks = chunkNarration(args.text, DEFAULT_CHUNK_CHARS);
    const parts: Buffer[] = [];
    for (let i = 0; i < chunks.length; i++) {
      parts.push(await this.synthesizeChunk(chunks[i]!, args.voiceId, chunks[i - 1], chunks[i + 1]));
    }
    // MPEG frames are self-delimiting, so concatenating the payloads yields a
    // playable stream; ffmpeg (in the renderer) decodes it as one track.
    const audio = parts.length === 1 ? parts[0]! : Buffer.concat(parts);

    return {
      audio,
      contentType: "audio/mpeg",
      extension: "mp3",
      // Exact duration is measured downstream from the audio itself (FAV-604);
      // mp3 length estimation here is intentionally avoided.
      durationSeconds: 0,
      costCredits: Math.max(1, Math.ceil(args.text.length / 1000) * COST_TABLE.ttsPerThousandChars)
    };
  }

  async listVoices() {
    const res = await this.request(`/voices`);
    if (!res.ok) throw new Error(`ElevenLabs voices HTTP ${res.status}`);
    const body = (await res.json()) as {
      voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }>;
    };
    return body.voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      language: v.labels?.language ?? "en",
      previewText: v.labels?.description ?? v.name
    }));
  }

  async cloneVoice(args: { name: string; sample: Buffer }): Promise<{ providerVoiceId: string }> {
    const form = new FormData();
    form.set("name", args.name);
    form.set("files", new Blob([new Uint8Array(args.sample)], { type: "audio/wav" }), "sample.wav");
    const res = await this.request(`/voices/add`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`ElevenLabs clone HTTP ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { voice_id: string };
    return { providerVoiceId: body.voice_id };
  }
}
