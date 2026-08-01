import { encodeWav, SAMPLE_RATE } from "./wav.js";

/** Chord progressions per mood for the royalty-free mock music library (FAV-805). */
const MOOD_PROGRESSIONS: Record<string, number[][]> = {
  // Frequencies in Hz: simple triads, one chord per 2 seconds.
  inspirational: [
    [261.6, 329.6, 392.0], // C
    [196.0, 246.9, 293.7], // G
    [220.0, 261.6, 329.6], // Am
    [174.6, 220.0, 261.6] // F
  ],
  energetic: [
    [220.0, 261.6, 329.6],
    [174.6, 220.0, 261.6],
    [261.6, 329.6, 392.0],
    [196.0, 246.9, 293.7]
  ],
  calm: [
    [174.6, 220.0, 261.6],
    [196.0, 246.9, 293.7],
    [146.8, 174.6, 220.0],
    [174.6, 220.0, 261.6]
  ]
};

/**
 * Synthesizes a soft ambient chord-pad loop so the "music library" is real,
 * playable audio in the keyless sandbox. Loudness sits well below narration;
 * final ducking happens at render time.
 */
export function synthesizeMusicTrack(mood: string, durationSeconds: number): Buffer {
  const progression = MOOD_PROGRESSIONS[mood] ?? MOOD_PROGRESSIONS.calm!;
  const total = Math.ceil(durationSeconds * SAMPLE_RATE);
  const samples = new Float32Array(total);
  const chordSeconds = 2;

  for (let i = 0; i < total; i++) {
    const tSec = i / SAMPLE_RATE;
    const chordIndex = Math.floor(tSec / chordSeconds) % progression.length;
    const chord = progression[chordIndex]!;
    const chordT = tSec % chordSeconds;
    // Gentle swell per chord to avoid clicks.
    const env = Math.min(1, chordT / 0.3) * Math.min(1, (chordSeconds - chordT) / 0.3);
    let sample = 0;
    for (const freq of chord) {
      sample += Math.sin(2 * Math.PI * freq * tSec) / chord.length;
      sample += 0.3 * Math.sin(2 * Math.PI * freq * 0.5 * tSec) / chord.length; // sub octave
    }
    samples[i] = sample * env * 0.25;
  }
  return encodeWav(samples);
}
