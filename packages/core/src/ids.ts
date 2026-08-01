const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Prefixed, sortable-enough, URL-safe ids: `vid_8f3k...`.
 * Uses Web Crypto so the module stays isomorphic (the render composition
 * bundle imports @fav/core in a browser context).
 */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  }
  return `${prefix}_${Date.now().toString(32)}${out}`;
}
