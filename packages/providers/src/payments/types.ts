/** Payments abstraction (FAV-1201/1202): Stripe in prod, a mock checkout in dev
 * that drives the exact same webhook handler. */

export interface CheckoutArgs {
  orgId: string;
  /** Either a subscription plan or a one-time credit pack. */
  kind: "plan" | "pack";
  itemId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

export interface PaymentEvent {
  /** Provider event id — the idempotency key (FAV-1202 AC). */
  id: string;
  type:
    | "checkout.completed.plan"
    | "checkout.completed.pack"
    | "subscription.renewed"
    | "subscription.canceled"
    | "unknown";
  orgId: string;
  itemId?: string;
  /** Provider-side customer/subscription references to persist. */
  customerId?: string;
  subscriptionId?: string;
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export interface PaymentsProvider {
  readonly name: string;
  createCheckoutSession(args: CheckoutArgs): Promise<{ url: string }>;
  /** Verify + parse a webhook request; throws WebhookVerificationError on bad signature. */
  parseWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentEvent>;
}
