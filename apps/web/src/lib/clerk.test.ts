import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clerkEnabled, verifyClerkWebhook } from "./clerk";

afterEach(() => vi.unstubAllEnvs());

const SECRET_BYTES = Buffer.from("clerk-webhook-signing-key-000000");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function sign(payload: string, id: string, timestamp: string): string {
  return `v1,${createHmac("sha256", SECRET_BYTES).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;
}

describe("Clerk integration (FAV-201)", () => {
  it("is inactive unless CLERK_SECRET_KEY is set", () => {
    expect(clerkEnabled()).toBe(false);
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_123");
    expect(clerkEnabled()).toBe(true);
  });

  it("accepts a correctly signed webhook", () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", SECRET);
    const payload = JSON.stringify({ type: "user.created", data: { id: "user_abc" } });
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(
      verifyClerkWebhook({ payload, svixId: id, svixTimestamp: timestamp, svixSignature: sign(payload, id, timestamp) })
    ).toBe(true);
  });

  it("rejects a tampered payload, a wrong signature, and missing headers", () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", SECRET);
    const payload = JSON.stringify({ type: "user.created", data: { id: "user_abc" } });
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(payload, id, timestamp);

    const tampered = JSON.stringify({ type: "user.created", data: { id: "user_evil" } });
    expect(
      verifyClerkWebhook({ payload: tampered, svixId: id, svixTimestamp: timestamp, svixSignature: signature })
    ).toBe(false);
    expect(
      verifyClerkWebhook({ payload, svixId: id, svixTimestamp: timestamp, svixSignature: "v1,bm90LWFzaWc=" })
    ).toBe(false);
    expect(verifyClerkWebhook({ payload, svixId: null, svixTimestamp: timestamp, svixSignature: signature })).toBe(
      false
    );
  });

  it("rejects a replayed delivery outside the timestamp window", () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", SECRET);
    const payload = "{}";
    const id = "msg_old";
    // Ten minutes old: a captured request must not work later.
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    expect(
      verifyClerkWebhook({ payload, svixId: id, svixTimestamp: timestamp, svixSignature: sign(payload, id, timestamp) })
    ).toBe(false);
  });

  it("rejects everything when no webhook secret is configured", () => {
    const payload = "{}";
    const id = "msg_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(
      verifyClerkWebhook({ payload, svixId: id, svixTimestamp: timestamp, svixSignature: sign(payload, id, timestamp) })
    ).toBe(false);
  });
});
