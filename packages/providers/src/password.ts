import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

/**
 * Password hashing (FAV-201) with scrypt from Node's crypto — no native
 * dependency, and memory-hard so GPU cracking is expensive.
 *
 * Parameters follow current OWASP guidance for scrypt (N=2^17, r=8, p=1).
 * The cost parameters live in the stored string, so they can be raised later
 * and old hashes still verify (and can be transparently upgraded on login).
 */
const PARAMS = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64")
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  try {
    const derived = await scrypt(password, Buffer.from(saltB64, "base64"), KEY_LENGTH, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: PARAMS.maxmem
    });
    const expected = Buffer.from(hashB64, "base64");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a hash was made with weaker parameters and should be re-hashed on login. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < PARAMS.N;
}

export interface PasswordProblem {
  ok: boolean;
  message?: string;
}

/**
 * Length-first policy: length beats composition rules for real-world strength,
 * and a small blocklist stops the passwords that actually get guessed.
 */
const COMMON = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "qwertyui",
  "letmein1",
  "iloveyou",
  "admin123",
  "welcome1",
  "changeme"
]);

export function validatePassword(password: string, email?: string): PasswordProblem {
  if (password.length < 10) return { ok: false, message: "Password must be at least 10 characters." };
  if (password.length > 200) return { ok: false, message: "Password must be under 200 characters." };
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return { ok: false, message: "That password is too common. Choose another." };

  // Only meaningful for a local part long enough to be identifying — otherwise
  // an address like jo@example.com would reject every password containing "jo".
  const localPart = email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
    return { ok: false, message: "Password must not contain your email address." };
  }
  return { ok: true };
}

/** URL-safe single-use token for verification and reset links. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
