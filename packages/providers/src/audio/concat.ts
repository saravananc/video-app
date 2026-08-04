import { encodeWav, SAMPLE_RATE } from "./wav.js";

/**
 * Concatenate PCM WAV buffers produced by chunked synthesis (FAV-604).
 * Only used for the WAV path (the mock provider and any WAV-returning
 * adapter); compressed formats are concatenated by the provider adapter,
 * which knows its own container.
 */
export function concatWav(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) return encodeWav(new Float32Array(0));
  if (buffers.length === 1) return buffers[0]!;

  const sampleRate = buffers[0]!.readUInt32LE(24);
  const samples: Float32Array[] = [];
  let total = 0;

  for (const buffer of buffers) {
    if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
      throw new Error("concatWav received a non-WAV buffer");
    }
    if (buffer.readUInt32LE(24) !== sampleRate) {
      throw new Error("concatWav received buffers with differing sample rates");
    }
    const dataLength = buffer.readUInt32LE(40);
    const count = Math.floor(dataLength / 2);
    const chunk = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      chunk[i] = buffer.readInt16LE(44 + i * 2) / 32767;
    }
    samples.push(chunk);
    total += count;
  }

  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of samples) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return encodeWav(merged, sampleRate || SAMPLE_RATE);
}
