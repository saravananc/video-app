"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Skeleton, StatusBadge } from "@/components/ui";

interface Account {
  id: string;
  platform: string;
  displayName: string | null;
  status: string;
  tokenExpiresAt: string | null;
}

const PLATFORMS = [
  { id: "youtube", name: "YouTube", blurb: "Upload Shorts and videos with metadata" },
  { id: "tiktok", name: "TikTok", blurb: "Post via the Content Posting API" },
  { id: "instagram", name: "Instagram", blurb: "Publish Reels via the Graph API" }
];

/** Social account connections (FAV-1301 + mock TikTok/Instagram until Phase E). */
export default function SocialPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/social/accounts", { cache: "no-store" });
    if (res.ok) setAccounts((await res.json()).accounts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnect(id: string) {
    setBusy(id);
    await fetch(`/api/social/accounts/${id}`, { method: "DELETE" });
    setBusy(null);
    void load();
  }

  if (!accounts) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Social accounts</h1>
        <p className="text-sm text-text-muted">
          Connect the platforms you publish to. Tokens are stored encrypted and refreshed automatically.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLATFORMS.map((platform) => {
          const connected = accounts.filter((a) => a.platform === platform.id);
          return (
            <Card key={platform.id} className="flex flex-col gap-3">
              <div>
                <p className="font-semibold">{platform.name}</p>
                <p className="text-xs text-text-muted">{platform.blurb}</p>
              </div>
              {connected.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded-lg border border-border-token px-3 py-2 text-sm"
                >
                  <span>{account.displayName ?? "Connected account"}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={account.status} />
                    <Button
                      variant="ghost"
                      className="px-2 py-0.5 text-xs text-danger"
                      disabled={busy !== null}
                      onClick={() => disconnect(account.id)}
                    >
                      {busy === account.id ? "…" : "Disconnect"}
                    </Button>
                  </span>
                </div>
              ))}
              <a href={`/api/social/connect/${platform.id}`}>
                <Button variant={connected.length > 0 ? "secondary" : "primary"} className="w-full">
                  {connected.length > 0 ? "Connect another" : "Connect"}
                </Button>
              </a>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
