import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider } from "../types.js";

/**
 * Filesystem storage for development (mirrors R2 semantics, FAV-1001):
 * keys map to files under FAV_DATA_DIR/storage, and signed URLs are
 * HMAC-signed app routes served by /api/assets/[...key] with expiry.
 */
export class FsStorageProvider implements StorageProvider {
  readonly name = "fs";

  constructor(
    private readonly rootDir: string,
    private readonly signingSecret: string,
    private readonly baseUrl: string
  ) {}

  private filePath(key: string): string {
    const normalized = path.normalize(key);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path.join(this.rootDir, normalized);
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.filePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.filePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.filePath(key), { force: true });
  }

  sign(key: string, expiresAtMs: number): string {
    return createHmac("sha256", this.signingSecret).update(`${key}:${expiresAtMs}`).digest("hex");
  }

  verify(key: string, expiresAtMs: number, signature: string): boolean {
    if (Date.now() > expiresAtMs) return false;
    const expected = this.sign(key, expiresAtMs);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const expiresAtMs = Date.now() + expiresInSeconds * 1000;
    const sig = this.sign(key, expiresAtMs);
    return `${this.baseUrl}/api/assets/${key}?exp=${expiresAtMs}&sig=${sig}`;
  }

  localPath(key: string): string {
    return this.filePath(key);
  }
}
