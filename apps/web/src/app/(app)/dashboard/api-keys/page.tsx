"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Skeleton } from "@/components/ui";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** API key management (FAV-1501) + developer docs pointer (FAV-1504). */
export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/keys", { cache: "no-store" });
    if (res.status === 403) {
      setError("API keys require admin or owner role");
      setKeys([]);
      return;
    }
    if (res.ok) setKeys((await res.json()).keys);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy("create");
    setError(null);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to create key");
      return;
    }
    setNewKey((await res.json()).key);
    setName("");
    void load();
  }

  async function revoke(id: string) {
    setBusy(id);
    await fetch(`/api/keys/${id}`, { method: "DELETE" });
    setBusy(null);
    void load();
  }

  if (!keys) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">API keys</h1>
        <p className="text-sm text-text-muted">
          Programmatic access to generation. Spec:{" "}
          <a href="/api/v1/openapi.json" className="text-accent" target="_blank">
            /api/v1/openapi.json
          </a>{" "}
          · Endpoints: <code className="text-xs">POST /api/v1/videos/generate</code>,{" "}
          <code className="text-xs">GET /api/v1/videos/{"{id}"}</code> · MCP server:{" "}
          <code className="text-xs">apps/mcp</code> (set FAV_API_URL + FAV_API_KEY).
        </p>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {newKey && (
        <Card className="border-success/40 bg-success/5">
          <p className="text-sm font-medium text-success">Key created — copy it now, it won't be shown again:</p>
          <code className="mt-2 block break-all rounded bg-bg-subtle p-2 text-xs">{newKey}</code>
          <Button variant="secondary" className="mt-2" onClick={() => setNewKey(null)}>
            I've copied it
          </Button>
        </Card>
      )}

      <Card className="flex items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Key name (e.g. CI pipeline)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button disabled={busy !== null || !name} onClick={create}>
          {busy === "create" ? "…" : "Issue key"}
        </Button>
      </Card>

      <div className="overflow-hidden rounded-xl border border-border-token">
        <table className="w-full text-sm">
          <thead className="bg-bg-subtle text-left text-xs uppercase text-text-muted">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Key</th>
              <th className="px-4 py-2">Scopes</th>
              <th className="px-4 py-2">Last used</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className={`border-t border-border-token ${key.revokedAt ? "opacity-50" : ""}`}>
                <td className="px-4 py-2">{key.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{key.keyPrefix}…</td>
                <td className="px-4 py-2 text-xs">{key.scopes.join(", ")}</td>
                <td className="px-4 py-2 text-xs text-text-muted">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "never"}
                </td>
                <td className="px-4 py-2 text-right">
                  {key.revokedAt ? (
                    <span className="text-xs text-text-muted">revoked</span>
                  ) : (
                    <Button
                      variant="ghost"
                      className="px-2 py-0.5 text-xs text-danger"
                      disabled={busy !== null}
                      onClick={() => revoke(key.id)}
                    >
                      {busy === key.id ? "…" : "Revoke"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
