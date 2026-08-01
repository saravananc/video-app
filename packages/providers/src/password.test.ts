import { describe, expect, it } from "vitest";
import { generateToken, hashPassword, needsRehash, validatePassword, verifyPassword } from "./password.js";

describe("password hashing (FAV-201)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("never stores the password, and salts so identical passwords differ", async () => {
    const a = await hashPassword("same-password-here");
    const b = await hashPassword("same-password-here");
    expect(a).not.toContain("same-password-here");
    expect(a).not.toBe(b);
    // Both still verify — different salts, same password.
    expect(await verifyPassword("same-password-here", a)).toBe(true);
    expect(await verifyPassword("same-password-here", b)).toBe(true);
  });

  it("rejects malformed or tampered hashes instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "notascrypthash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$2$3$bad$bad")).toBe(false);
    const real = await hashPassword("a-real-password");
    const parts = real.split("$");
    parts[5] = Buffer.from("wrong").toString("base64");
    expect(await verifyPassword("a-real-password", parts.join("$"))).toBe(false);
  });

  it("flags hashes made with weaker parameters for upgrade", async () => {
    const current = await hashPassword("current-params-pw");
    expect(needsRehash(current)).toBe(false);
    const weak = ["scrypt", 16384, 8, 1, "c2FsdA==", "aGFzaA=="].join("$");
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash("garbage")).toBe(true);
  });
});

describe("password policy", () => {
  it("requires reasonable length", () => {
    expect(validatePassword("short").ok).toBe(false);
    expect(validatePassword("a".repeat(250)).ok).toBe(false);
    expect(validatePassword("a-perfectly-fine-password").ok).toBe(true);
  });

  it("blocks common passwords and ones containing the email", () => {
    expect(validatePassword("password1").ok).toBe(false);
    expect(validatePassword("jsmith-is-my-password", "jsmith@example.com").ok).toBe(false);
    expect(validatePassword("unrelated-strong-phrase", "jsmith@example.com").ok).toBe(true);
  });
});

describe("tokens", () => {
  it("generates unguessable, URL-safe, unique tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(40);
    }
  });
});
