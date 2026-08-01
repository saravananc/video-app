import { z } from "zod";

/** A single word with exact timing from transcription (FAV-701). */
export const wordTimestampSchema = z.object({
  word: z.string(),
  startSec: z.number().min(0),
  endSec: z.number().min(0)
});
export type WordTimestamp = z.infer<typeof wordTimestampSchema>;

/** A caption cue: a readable chunk of words shown together (FAV-702). */
export const captionCueSchema = z.object({
  text: z.string(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  words: z.array(wordTimestampSchema)
});
export type CaptionCue = z.infer<typeof captionCueSchema>;

const MAX_WORDS_PER_CUE = 5;
const MAX_CUE_DURATION_SEC = 3.5;

/**
 * Group word timestamps into readable caption cues (FAV-702).
 * Cues break on word-count, duration, or sentence-ending punctuation.
 */
export function buildCaptionCues(words: WordTimestamp[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let current: WordTimestamp[] = [];

  const flush = () => {
    if (current.length === 0) return;
    cues.push({
      text: current.map((w) => w.word).join(" "),
      startSec: current[0]!.startSec,
      endSec: current[current.length - 1]!.endSec,
      words: current
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    const duration = word.endSec - current[0]!.startSec;
    const endsSentence = /[.!?]$/.test(word.word);
    if (current.length >= MAX_WORDS_PER_CUE || duration >= MAX_CUE_DURATION_SEC || endsSentence) {
      flush();
    }
  }
  flush();
  return cues;
}
