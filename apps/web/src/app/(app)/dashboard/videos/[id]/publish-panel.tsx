"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, StatusBadge, Textarea } from "@/components/ui";

interface Account {
  id: string;
  platform: string;
  displayName: string | null;
  status: string;
}

interface PublishRecord {
  id: string;
  platform: string;
  status: string;
  title: string;
  externalPostId: string | null;
  error: string | null;
  publishedAt: string | null;
}

/** Publish a completed video to connected accounts + track jobs (FAV-1302/1306). */
export function PublishPanel({ videoId, defaultTitle }: { videoId: string; defaultTitle: string }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [publishes, setPublishes] = useState<PublishRecord[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [accRes, pubRes] = await Promise.all([
      fetch("/api/social/accounts", { cache: "no-store" }),
      fetch(`/api/videos/${videoId}/publish`, { cache: "no-store" })
    ]);
    if (accRes.ok) {
      const body = await accRes.json();
      setAccounts(body.accounts);
      if (body.accounts.length > 0 && !accountId) setAccountId(body.accounts[0].id);
    }
    if (pubRes.ok) setPublishes((await pubRes.json()).publishes);
  }, [videoId, accountId]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function publish() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/videos/${videoId}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ socialAccountId: accountId, title, description: description || undefined, visibility })
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Publish failed");
      return;
    }
    void load();
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Publish</h2>

      {accounts === null ? (
        <p className="text-sm text-text-muted">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">No social accounts connected yet.</p>
          <a href="/dashboard/social">
            <Button variant="secondary">Connect an account</Button>
          </a>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setAccountId(a.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                  accountId === a.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border-token text-text-muted"
                }`}
              >
                {a.platform} — {a.displayName ?? "account"}
                {a.status !== "connected" ? " (reconnect needed)" : ""}
              </button>
            ))}
          </div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={100} />
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {(["public", "unlisted", "private"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVisibility(v)}
                  className={`rounded-lg border px-3 py-1 text-xs capitalize ${
                    visibility === v ? "border-accent bg-accent/10 text-accent" : "border-border-token text-text-muted"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <Button disabled={busy || !accountId || !title} onClick={publish}>
              {busy ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
      )}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {publishes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">History</p>
          {publishes.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-border-token px-3 py-2 text-sm"
            >
              <span className="capitalize">
                {p.platform} · {p.title}
                {p.externalPostId ? <span className="ml-2 text-xs text-text-muted">{p.externalPostId}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                {p.error ? <span className="max-w-48 truncate text-xs text-danger">{p.error}</span> : null}
                <StatusBadge status={p.status} />
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
