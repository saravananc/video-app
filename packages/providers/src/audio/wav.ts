/** Minimal 16-bit PCM mono WAV encoding — used by the mock TTS so the pipeline
 * produces real, playable audio with an exact known duration and zero deps. */

export const SAMPLE_RATE = 22050;

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] as number));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

export function wavDurationSeconds(wav: Buffer): number {
  const dataLength = wav.readUInt32LE(40);
  const sampleRate = wav.readUInt32LE(24);
  const bytesPerSample = wav.readUInt16LE(34) / 8;
  const channels = wav.readUInt16LE(22);
  return dataLength / (sampleRate * bytesPerSample * channels);
}
