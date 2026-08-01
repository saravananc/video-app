import {
  sceneCountForDuration,
  videoScriptSchema,
  type ScriptGenerationInput,
  type VideoScript
} from "@fav/core";
import type { LlmProvider } from "../types.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.FAV_ANTHROPIC_MODEL ?? "claude-sonnet-5";
const MAX_ATTEMPTS = 3;

/**
 * Real adapter (FAV-401): plain fetch against the Anthropic Messages API, with
 * schema validation + retry on malformed output (FAV-402 AC) and retry with
 * jitter on transient HTTP failures.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";

  constructor(private readonly apiKey: string) {}

  private async complete(prompt: string, maxTokens = 4000): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt * (0.5 + Math.random())));
      }
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: maxTokens,
            messages: [{ role: "user", content: prompt }]
          })
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`Anthropic HTTP ${res.status}`);
          continue;
        }
        if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
        const body = (await res.json()) as {
          content: Array<{ type: string; text?: string }>;
          usage?: { input_tokens: number; output_tokens: number };
        };
        if (body.usage) {
          console.log(
            JSON.stringify({ event: "llm_usage", provider: this.name, model: MODEL, ...body.usage })
          );
        }
        return body.content.find((c) => c.type === "text")?.text ?? "";
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async generateScript(input: ScriptGenerationInput): Promise<VideoScript> {
    const sceneCount = sceneCountForDuration(input.targetDurationSeconds);
    const prompt = [
      `Write a ${input.targetDurationSeconds}-second faceless short-form video script about: ${input.topic}`,
      `Tone: ${input.tone}. Visual style: ${input.visualStyle}. Language: ${input.language}.`,
      `Exactly ${sceneCount} scenes. Narration paced at ~150 words per minute total.`,
      `Respond with ONLY valid JSON matching this schema, no markdown fences:`,
      `{"title": string, "hook": string, "scenes": [{"index": number, "narration": string, "visualPrompt": string, "onScreenText"?: string}]}`
    ].join("\n");

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const raw = await this.complete(prompt);
      try {
        const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
        return videoScriptSchema.parse(JSON.parse(cleaned));
      } catch (err) {
        // Malformed output rejected + retried (FAV-402 AC).
        lastError = err;
      }
    }
    throw new Error(`LLM returned invalid script after ${MAX_ATTEMPTS} attempts: ${lastError}`);
  }

  async generateIdea(niche: string, avoid: string[]): Promise<string> {
    const raw = await this.complete(
      `Suggest one specific, original short-form video topic in the niche "${niche}". ` +
        (avoid.length ? `Avoid anything similar to: ${avoid.join("; ")}. ` : "") +
        `Respond with only the topic, one line, no quotes.`,
      200
    );
    return raw.trim().split("\n")[0]!.slice(0, 200);
  }
}
