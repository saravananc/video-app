"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { packById, planById } from "@fav/core";
import { Button, Card } from "@/components/ui";

/**
 * Dev-only fake checkout page (mock payments provider). Confirming posts a
 * signed event through the real webhook pipeline — same code path as Stripe.
 */
function MockCheckout() {
  const params = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = (params.get("kind") ?? "pack") as "plan" | "pack";
  const itemId = params.get("itemId") ?? "";
  const item = kind === "plan" ? planById(itemId) : packById(itemId);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/billing/mock-confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, itemId })
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Payment failed");
      return;
    }
    router.push("/billing?status=success");
    router.refresh();
  }

  if (!item) return <p className="text-danger">Unknown item</p>;

  return (
    <div className="mx-auto max-w-md">
      <Card className="flex flex-col gap-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-warning">Test checkout — no real payment</p>
        <p className="text-lg font-semibold">{item.name}</p>
        <p className="text-3xl font-bold">${(item.priceCents / 100).toFixed(2)}</p>
        <p className="text-sm text-text-muted">
          {"monthlyCredits" in item ? `${item.monthlyCredits} credits / month` : `${item.credits} credits, never expire`}
        </p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={() => router.push("/billing?status=canceled")}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={confirm}>
            {busy ? "Processing…" : "Confirm purchase"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense>
      <MockCheckout />
    </Suspense>
  );
}
