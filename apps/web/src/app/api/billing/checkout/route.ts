import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { packById, planById } from "@fav/core";
import { getPaymentsProvider } from "@fav/providers";
import { authErrorResponse, requireBillingAccess } from "@/lib/org";

const checkoutSchema = z.object({
  kind: z.enum(["plan", "pack"]),
  itemId: z.string()
});

/** Start a checkout for a plan or top-up pack (FAV-1201/1203). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireBillingAccess();
    const parsed = checkoutSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const { kind, itemId } = parsed.data;
    const item = kind === "plan" ? planById(itemId) : packById(itemId);
    if (!item || (kind === "plan" && itemId === "free")) {
      return NextResponse.json({ error: "Unknown item" }, { status: 400 });
    }

    const baseUrl = process.env.FAV_BASE_URL ?? req.nextUrl.origin;
    const payments = getPaymentsProvider();
    const { url } = await payments.createCheckoutSession({
      orgId: session.orgId,
      kind,
      itemId,
      successUrl: `${baseUrl}/billing?status=success`,
      cancelUrl: `${baseUrl}/billing?status=canceled`,
      customerEmail: session.user.email
    });
    return NextResponse.json({ url });
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
