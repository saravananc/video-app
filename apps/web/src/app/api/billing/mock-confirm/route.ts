import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newId } from "@fav/core";
import { getPaymentsProvider, MockPaymentsProvider } from "@fav/providers";
import { authErrorResponse, requireBillingAccess } from "@/lib/org";

const confirmSchema = z.object({
  kind: z.enum(["plan", "pack"]),
  itemId: z.string()
});

/**
 * Dev-only checkout confirmation: emits a signed mock payment event to the real
 * webhook endpoint, exercising signature verification, idempotency, and ledger
 * crediting exactly as Stripe would (FAV-1202). 404s when Stripe is active.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireBillingAccess();
    const payments = getPaymentsProvider();
    if (!(payments instanceof MockPaymentsProvider)) {
      return NextResponse.json({ error: "Not available" }, { status: 404 });
    }
    const parsed = confirmSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const payload = JSON.stringify({
      id: newId("evt"),
      kind: parsed.data.kind,
      orgId: session.orgId,
      itemId: parsed.data.itemId
    });
    const baseUrl = process.env.FAV_BASE_URL ?? req.nextUrl.origin;
    const res = await fetch(`${baseUrl}/api/webhooks/payments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fav-signature": payments.sign(payload) },
      body: payload
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Webhook failed: ${res.status}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
