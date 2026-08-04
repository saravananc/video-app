"use client";

import { useCallback, useEffect, useState } from "react";
import { CREDIT_PACKS, PLANS } from "@fav/core";
import { Button, Card, Skeleton } from "@/components/ui";

interface LedgerData {
  balance: number;
  plan: string;
  entries: Array<{
    id: string;
    entryType: string;
    amount: number;
    reason: string | null;
    createdAt: string;
  }>;
}

interface Invoice {
  id: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  creditsGranted: number | null;
  hostedInvoiceUrl: string | null;
  issuedAt: string;
}

/** Billing: balance, plan, top-ups, ledger history (FAV-1201/1203/1206 MVP). */
export default function BillingPage() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ledgerRes, invoiceRes] = await Promise.all([
      fetch("/api/billing/ledger", { cache: "no-store" }),
      fetch("/api/billing/invoices", { cache: "no-store" })
    ]);
    if (ledgerRes.ok) setData(await ledgerRes.json());
    else setError((await ledgerRes.json()).error ?? "Failed to load billing");
    // Invoices are admin+ only; a 403 here just means no invoice section.
    if (invoiceRes.ok) setInvoices((await invoiceRes.json()).invoices);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkout(kind: "plan" | "pack", itemId: string) {
    setBusy(itemId);
    setError(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, itemId })
    });
    setBusy(null);
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Checkout failed");
      return;
    }
    window.location.href = body.url;
  }

  if (error && !data) return <p className="text-danger">{error}</p>;
  if (!data)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-sm text-text-muted">
            Plan: <span className="font-medium capitalize text-text">{data.plan}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-accent">{data.balance}</p>
          <p className="text-sm text-text-muted">credits available</p>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Subscription plans</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {Object.values(PLANS)
            .filter((p) => p.id !== "free")
            .map((plan) => (
              <Card key={plan.id} className="flex flex-col gap-2">
                <p className="font-semibold">{plan.name}</p>
                <p className="text-2xl font-bold">
                  ${(plan.priceCents / 100).toFixed(0)}
                  <span className="text-sm font-normal text-text-muted">/mo</span>
                </p>
                <p className="text-sm text-text-muted">{plan.monthlyCredits} credits / month</p>
                <p className="text-xs text-text-muted">
                  Up to {plan.maxResolution} · {plan.tiers.join(", ")} tiers
                </p>
                <Button
                  className="mt-2"
                  variant={data.plan === plan.id ? "secondary" : "primary"}
                  disabled={busy !== null || data.plan === plan.id}
                  onClick={() => checkout("plan", plan.id)}
                >
                  {data.plan === plan.id ? "Current plan" : busy === plan.id ? "…" : "Subscribe"}
                </Button>
              </Card>
            ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Credit top-ups</h2>
        <p className="mb-3 text-sm text-text-muted">One-time purchases — these credits never expire.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {CREDIT_PACKS.map((pack) => (
            <Card key={pack.id} className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{pack.credits} credits</p>
                <p className="text-sm text-text-muted">${(pack.priceCents / 100).toFixed(2)}</p>
              </div>
              <Button variant="secondary" disabled={busy !== null} onClick={() => checkout("pack", pack.id)}>
                {busy === pack.id ? "…" : "Buy"}
              </Button>
            </Card>
          ))}
        </div>
      </section>

      {invoices.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Invoices</h2>
          <div className="overflow-hidden rounded-xl border border-border-token">
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-left text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">Credits</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-border-token">
                    <td className="px-4 py-2.5 text-text-muted">
                      {new Date(inv.issuedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric"
                      })}
                    </td>
                    <td className="px-4 py-2.5">{inv.description}</td>
                    <td className="px-4 py-2.5 text-text-muted">
                      {inv.creditsGranted ? `+${inv.creditsGranted}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {(inv.amountCents / 100).toLocaleString(undefined, {
                        style: "currency",
                        currency: inv.currency.toUpperCase()
                      })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {inv.hostedInvoiceUrl ? (
                        <a href={inv.hostedInvoiceUrl} target="_blank" className="text-xs text-accent">
                          View
                        </a>
                      ) : (
                        <span className="text-xs capitalize text-success">{inv.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Credit history</h2>
        <div className="overflow-hidden rounded-xl border border-border-token">
          <table className="w-full text-sm">
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="border-b border-border-token last:border-0">
                  <td className="px-4 py-2.5 capitalize text-text-muted">{e.entryType.replace("_", " ")}</td>
                  <td className="px-4 py-2.5">{e.reason ?? "—"}</td>
                  <td
                    className={`px-4 py-2.5 text-right font-medium ${e.amount >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {e.amount >= 0 ? "+" : ""}
                    {e.amount}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-text-muted">
                    {new Date(e.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
