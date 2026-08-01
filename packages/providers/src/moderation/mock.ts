import type { ModerationProvider, ModerationResult } from "../types.js";

/**
 * Keyword-list moderation (FAV-405): blocks clearly prohibited topics before any
 * provider spend. Real deployments can swap in a provider-backed classifier via
 * FAV_MODERATION_PROVIDER without touching the pipeline.
 */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(child|minor)s?\b.*\b(sexual|explicit|nude)/i, category: "csae" },
  { pattern: /\b(sexual|explicit|nude)\b.*\b(child|minor)s?\b/i, category: "csae" },
  { pattern: /\bhow to (make|build|synthesize)\b.*\b(bomb|explosive|nerve agent|bioweapon)/i, category: "weapons" },
  { pattern: /\b(kill|murder|assassinate)\b.*\b(person|people|someone|politician)\b/i, category: "violence" },
  { pattern: /\bsuicide methods?\b/i, category: "self-harm" }
];

const FLAGGED_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(gore|graphic violence|beheading)\b/i, category: "graphic" },
  { pattern: /\b(conspiracy|hoax)\b/i, category: "misinformation-risk" }
];

export class MockModerationProvider implements ModerationProvider {
  readonly name = "mock";

  async moderate(text: string): Promise<ModerationResult> {
    const blocked = BLOCKED_PATTERNS.filter((p) => p.pattern.test(text));
    if (blocked.length > 0) {
      return { verdict: "blocked", categories: blocked.map((b) => b.category) };
    }
    const flagged = FLAGGED_PATTERNS.filter((p) => p.pattern.test(text));
    if (flagged.length > 0) {
      return { verdict: "flagged", categories: flagged.map((f) => f.category) };
    }
    return { verdict: "allowed", categories: [] };
  }
}
