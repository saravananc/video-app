import { logger } from "@fav/core";
import type { ModerationProvider, ModerationResult } from "../types.js";
import { MockModerationProvider } from "./mock.js";

const ENDPOINT = "https://api.openai.com/v1/moderations";

/** Read per call, not at import, so load order can't freeze in a stale value. */
function model(): string {
  return process.env.FAV_MODERATION_MODEL ?? "omni-moderation-latest";
}

function scoredThreshold(): number {
  const parsed = Number(process.env.FAV_MODERATION_THRESHOLD);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.7;
}

/**
 * Categories that always block. These are bright lines — no score threshold
 * makes them acceptable, and letting them reach a provider risks the account.
 */
const BLOCKING_CATEGORIES = new Set([
  "sexual/minors",
  "illicit/violent",
  "self-harm/instructions",
  "hate/threatening",
  "harassment/threatening",
  "violence/graphic"
]);

interface OpenAiModerationResponse {
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
}

/**
 * Real content moderation via OpenAI's moderation endpoint (FAV-405/1605).
 *
 * Layered deliberately:
 *  1. The keyword list runs first — it is instant, free, and catches the
 *     obvious cases without a network call.
 *  2. The classifier catches everything phrasing can slip past a regex.
 *
 * On classifier failure the keyword verdict stands and the decision is marked
 * `flagged` rather than `allowed`. Failing fully closed would take generation
 * down with a third-party outage; failing fully open would leave prompts
 * unscreened. Flagging keeps content flowing while making the degraded window
 * visible in `moderation_decisions` for review.
 */
export class OpenAiModerationProvider implements ModerationProvider {
  readonly name = "openai";
  private readonly keywords = new MockModerationProvider();

  constructor(private readonly apiKey: string) {}

  async moderate(text: string): Promise<ModerationResult> {
    // Layer 1: the cheap check, which also covers us if layer 2 is unavailable.
    const keywordVerdict = await this.keywords.moderate(text);
    if (keywordVerdict.verdict === "blocked") return keywordVerdict;

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ model: model(), input: text.slice(0, 4000) })
      });
      if (!res.ok) throw new Error(`OpenAI moderation HTTP ${res.status}`);

      const body = (await res.json()) as OpenAiModerationResponse;
      const result = body.results[0];
      if (!result) throw new Error("OpenAI moderation returned no result");

      const blocking: string[] = [];
      const flagged: string[] = [];
      // A documentary about violence is legitimate; a how-to is not. Scored
      // categories block only above this confidence.
      const threshold = scoredThreshold();

      for (const [category, isFlagged] of Object.entries(result.categories)) {
        if (!isFlagged) continue;
        const score = result.category_scores[category] ?? 0;
        if (BLOCKING_CATEGORIES.has(category) || score >= threshold) {
          blocking.push(category);
        } else {
          flagged.push(category);
        }
      }

      if (blocking.length > 0) return { verdict: "blocked", categories: blocking };
      if (flagged.length > 0 || keywordVerdict.verdict === "flagged") {
        return { verdict: "flagged", categories: [...new Set([...flagged, ...keywordVerdict.categories])] };
      }
      return { verdict: "allowed", categories: [] };
    } catch (err) {
      logger.error("moderation_classifier_unavailable", err, {
        provider: this.name,
        fallback: "keyword-list"
      });
      // Degraded: keyword screening still applied, but surfaced for review.
      return {
        verdict: keywordVerdict.verdict === "allowed" ? "flagged" : keywordVerdict.verdict,
        categories: [...keywordVerdict.categories, "classifier-unavailable"]
      };
    }
  }
}
