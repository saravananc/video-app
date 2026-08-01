import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generateToken } from "@fav/providers";
import { createTestDb, type Db } from "./client.js";
import { migrateTestDb } from "./migrate.js";
import { seed } from "./seed.js";
import { consumeAuthToken, issueAuthToken } from "./auth-tokens.js";
import { authTokens } from "./schema.js";

const USER = "user_demo_owner";

describe("auth tokens (FAV-201)", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await seed(db);
  });

  it("issues a token that verifies once and only once", async () => {
    const token = generateToken();
    await issueAuthToken(db, USER, "password_reset", token);

    const first = await consumeAuthToken(db, "password_reset", token);
    expect(first?.userId).toBe(USER);
    // Single use: a replayed link does nothing.
    expect(await consumeAuthToken(db, "password_reset", token)).toBeNull();
  });

  it("stores only a hash, never the token itself", async () => {
    const token = generateToken();
    await issueAuthToken(db, USER, "email_verification", token);
    const [row] = await db.select().from(authTokens).where(eq(authTokens.userId, USER));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a token used for the wrong purpose", async () => {
    const token = generateToken();
    await issueAuthToken(db, USER, "email_verification", token);
    expect(await consumeAuthToken(db, "password_reset", token)).toBeNull();
    // Still valid for its actual purpose.
    expect(await consumeAuthToken(db, "email_verification", token)).not.toBeNull();
  });

  it("rejects expired tokens", async () => {
    const token = generateToken();
    await issueAuthToken(db, USER, "password_reset", token);
    await db
      .update(authTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authTokens.userId, USER));
    expect(await consumeAuthToken(db, "password_reset", token)).toBeNull();
  });

  it("issuing a new token invalidates the outstanding one", async () => {
    const older = generateToken();
    await issueAuthToken(db, USER, "password_reset", older);
    const newer = generateToken();
    await issueAuthToken(db, USER, "password_reset", newer);

    expect(await consumeAuthToken(db, "password_reset", older)).toBeNull();
    expect(await consumeAuthToken(db, "password_reset", newer)).not.toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect(await consumeAuthToken(db, "password_reset", generateToken())).toBeNull();
  });

  it("concurrent redemptions of the same token: exactly one wins", async () => {
    const token = generateToken();
    await issueAuthToken(db, USER, "password_reset", token);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeAuthToken(db, "password_reset", token))
    );
    expect(results.filter(Boolean).length).toBe(1);
  });
});
