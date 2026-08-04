/**
 * Narration chunking (FAV-604 AC: "handles long scripts via chunking").
 *
 * TTS providers cap request length — ElevenLabs rejects roughly past 5k
 * characters — so a long script must be split, synthesized piecewise, and
 * stitched back together. Splitting on sentence boundaries keeps prosody
 * natural; a mid-sentence cut is audible.
 */

export const DEFAULT_CHUNK_CHARS = 4000;

/**
 * Split text into chunks no longer than maxChars, preferring sentence
 * boundaries, then clause boundaries, then whitespace. A single word longer
 * than the limit is hard-split rather than dropped.
 */
export function chunkNarration(text: string, maxChars = DEFAULT_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Keep the delimiter attached to the sentence it ends.
  const sentences = trimmed.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    const value = current.trim();
    if (value.length > 0) chunks.push(value);
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // One oversized sentence: fall back to word packing.
      push();
      for (const word of sentence.split(/\s+/)) {
        if (word.length > maxChars) {
          push();
          for (let i = 0; i < word.length; i += maxChars) chunks.push(word.slice(i, i + maxChars));
          continue;
        }
        if (current.length + word.length + 1 > maxChars) push();
        current += (current ? " " : "") + word;
      }
      push();
      continue;
    }

    if (current.length + sentence.length > maxChars) push();
    current += sentence;
  }
  push();

  return chunks;
}
