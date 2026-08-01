import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutArgs, PaymentEvent, PaymentsProvider } from "./types.js";
import { WebhookVerificationError } from "./types.js";

const API = "https://api.stripe.com/v1";

/**
 * Real Stripe adapter (FAV-1201/1202) via the REST API: Checkout Sessions with
 * org metadata, and webhook signature verification per Stripe's v1 scheme
 * (t=timestamp,v1=hmac of "{t}.{payload}").
 */
export class StripePaymentsProvider implements PaymentsProvider {
  readonly name = "stripe";

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    /** plan/pack id -> Stripe price id, from env (FAV-103). */
    private readonly priceMap: Record<string, string>
  ) {}

  private async post(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(form).toString()
    });
    if (!res.ok) throw new Error(`Stripe HTTP ${res.status}: ${await res.text()}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async createCheckoutSession(args: CheckoutArgs): Promise<{ url: string }> {
    const price = this.priceMap[args.itemId];
    if (!price) throw new Error(`No Stripe price configured for ${args.itemId}`);
    const session = await this.post("/checkout/sessions", {
      mode: args.kind === "plan" ? "subscription" : "payment",
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "metadata[orgId]": args.orgId,
      "metadata[kind]": args.kind,
      "metadata[itemId]": args.itemId,
      ...(args.customerEmail ? { customer_email: args.customerEmail } : {})
    });
    return { url: String(session.url) };
  }

  verifySignature(rawBody: string, header: string): void {
    const parts = Object.fromEntries(
      header.split(",").map((kv) => kv.split("=") as [string, string])
    );
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) throw new WebhookVerificationError("Malformed Stripe-Signature");
    const tolerance = 5 * 60 * 1000;
    if (Math.abs(Date.now() - Number(timestamp) * 1000) > tolerance) {
      throw new WebhookVerificationError("Stale webhook timestamp");
    }
    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookVerificationError("Bad Stripe signature");
    }
  }

  async parseWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent> {
    if (!signatureHeader) throw new WebhookVerificationError("Missing Stripe-Signature");
    this.verifySignature(rawBody, signatureHeader);

    const event = JSON.parse(rawBody) as {
      id: string;
      type: string;
      data: {
        object: {
          metadata?: Record<string, string>;
          customer?: string;
          subscription?: string;
          mode?: string;
          lines?: { data?: Array<{ metadata?: Record<string, string> }> };
        };
      };
    };
    const obj = event.data.object;
    const metadata = obj.metadata ?? obj.lines?.data?.[0]?.metadata ?? {};

    let type: PaymentEvent["type"] = "unknown";
    if (event.type === "checkout.session.completed") {
      type = metadata.kind === "pack" ? "checkout.completed.pack" : "checkout.completed.plan";
    } else if (event.type === "invoice.paid") {
      type = "subscription.renewed";
    } else if (event.type === "customer.subscription.deleted") {
      type = "subscription.canceled";
    }

    return {
      id: event.id,
      type,
      orgId: metadata.orgId ?? "",
      itemId: metadata.itemId,
      customerId: obj.customer,
      subscriptionId: obj.subscription
    };
  }
}
