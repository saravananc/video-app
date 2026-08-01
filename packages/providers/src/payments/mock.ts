import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutArgs, PaymentEvent, PaymentsProvider } from "./types.js";
import { WebhookVerificationError } from "./types.js";

/**
 * Mock payments (dev, keyless): "checkout" is a local confirmation page that
 * posts a signed event to the same webhook endpoint the Stripe adapter uses —
 * so ledger crediting, idempotency, and plan updates are exercised for real.
 */
export class MockPaymentsProvider implements PaymentsProvider {
  readonly name = "mock";

  constructor(
    private readonly secret: string,
    private readonly baseUrl: string
  ) {}

  sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  async createCheckoutSession(args: CheckoutArgs): Promise<{ url: string }> {
    const params = new URLSearchParams({
      orgId: args.orgId,
      kind: args.kind,
      itemId: args.itemId,
      successUrl: args.successUrl,
      cancelUrl: args.cancelUrl
    });
    return { url: `${this.baseUrl}/billing/mock-checkout?${params.toString()}` };
  }

  async parseWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent> {
    if (!signatureHeader) throw new WebhookVerificationError("Missing signature");
    const expected = this.sign(rawBody);
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookVerificationError("Bad signature");
    }
    const body = JSON.parse(rawBody) as {
      id: string;
      kind: "plan" | "pack";
      orgId: string;
      itemId: string;
    };
    return {
      id: body.id,
      type: body.kind === "plan" ? "checkout.completed.plan" : "checkout.completed.pack",
      orgId: body.orgId,
      itemId: body.itemId,
      customerId: `mock_cus_${body.orgId}`,
      subscriptionId: body.kind === "plan" ? `mock_sub_${body.orgId}` : undefined
    };
  }
}
