import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Prefixed, sortable-enough, URL-safe ids: `vid_8f3k...`. */
export function newId(prefix: string): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  }
  return `${prefix}_${Date.now().toString(32)}${out}`;
}
