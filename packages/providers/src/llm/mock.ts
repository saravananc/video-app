import {
  sceneCountForDuration,
  videoScriptSchema,
  type ScriptGenerationInput,
  type VideoScript
} from "@fav/core";
import type { LlmProvider } from "../types.js";

/** Deterministic hash so the same topic always yields the same script. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ANGLES = [
  "the surprising origin of",
  "what nobody tells you about",
  "how experts think about",
  "the hidden mechanics behind",
  "why the world changed because of",
  "the fastest way to understand",
  "three misconceptions about",
  "the future of"
];

const FACT_FRAMES = [
  (t: string, i: number) => `Here's something remarkable: aspect number ${i + 1} of ${t} shaped how we see it today.`,
  (t: string, i: number) => `Most people miss this — the ${ordinal(i + 1)} key detail about ${t} hides in plain sight.`,
  (t: string, _i: number) => `Consider this: ${t} works the way it does because of one decision made long ago.`,
  (t: string, i: number) => `Experts agree the ${ordinal(i + 1)} turning point for ${t} changed everything that followed.`,
  (t: string, _i: number) => `And here's the twist — what you assumed about ${t} is only half the story.`
];

function ordinal(n: number): string {
  return ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"][n - 1] ?? `${n}th`;
}

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";

  async generateScript(input: ScriptGenerationInput): Promise<VideoScript> {
    const seed = hash(input.topic + input.tone);
    const sceneCount = sceneCountForDuration(input.targetDurationSeconds);
    const angle = ANGLES[seed % ANGLES.length]!;

    const scenes = Array.from({ length: sceneCount }, (_, i) => {
      const frame = FACT_FRAMES[(seed + i) % FACT_FRAMES.length]!;
      const narration =
        i === 0
          ? `Let's explore ${angle} ${input.topic}. ${frame(input.topic, i)}`
          : i === sceneCount - 1
            ? `${frame(input.topic, i)} Now you know ${input.topic} like few others do — follow for more.`
            : frame(input.topic, i);
      return {
        index: i,
        narration,
        visualPrompt: `${input.visualStyle} illustration of ${input.topic}, scene ${i + 1}: ${angle} ${input.topic}, ${input.tone} mood, high detail`,
        onScreenText: i === 0 ? input.topic.slice(0, 60) : undefined
      };
    });

    return videoScriptSchema.parse({
      title: `${input.topic.slice(0, 100)} — ${angle.split(" ").slice(0, 3).join(" ")}`,
      hook: `You've never seen ${input.topic} explained like this.`,
      scenes
    });
  }

  async generateIdea(niche: string, avoid: string[]): Promise<string> {
    const seed = hash(niche + avoid.join("|")) + avoid.length;
    const angle = ANGLES[seed % ANGLES.length]!;
    return `${angle} ${niche} (part ${avoid.length + 1})`;
  }
}
