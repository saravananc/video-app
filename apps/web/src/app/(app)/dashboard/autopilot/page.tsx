"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Skeleton, StatusBadge } from "@/components/ui";

interface Rule {
  id: string;
  name: string;
  niche: string;
  cadence: string;
  enabled: boolean;
  requiresReview: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

interface Run {
  id: string;
  status: string;
  ideaTopic: string | null;
  error: string | null;
  creditsSpent: number | null;
  startedAt: string;
}

/** Autopilot: rule builder, pause/resume, run history (FAV-1401/1404/1405). */
export default function AutopilotPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [runs, setRuns] = useState<Record<string, Run[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [cadence, setCadence] = useState("daily");
  const [requiresReview, setRequiresReview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/autopilot/rules", { cache: "no-store" });
    if (res.ok) setRules((await res.json()).rules);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRule() {
    setBusy("create");
    setError(null);
    const res = await fetch("/api/autopilot/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, niche, cadence, requiresReview })
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to create rule");
      return;
    }
    setName("");
    setNiche("");
    void load();
  }

  async function toggle(rule: Rule) {
    setBusy(rule.id);
    await fetch(`/api/autopilot/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled })
    });
    setBusy(null);
    void load();
  }

  async function showRuns(ruleId: string) {
    if (expanded === ruleId) {
      setExpanded(null);
      return;
    }
    const res = await fetch(`/api/autopilot/rules/${ruleId}`, { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setRuns((prev) => ({ ...prev, [ruleId]: body.runs }));
      setExpanded(ruleId);
    }
  }

  if (!rules) {
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
        <h1 className="text-2xl font-bold">Autopilot</h1>
        <p className="text-sm text-text-muted">
          Hands-off generation and publishing on a schedule. Each run creates an original topic in your niche.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <p className="font-semibold">New rule</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Rule name (e.g. Daily history shorts)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Niche (e.g. ancient history mysteries)" value={niche} onChange={(e) => setNiche(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {["daily", "weekly", "every:12h", "every:2d"].map((c) => (
              <button
                key={c}
                onClick={() => setCadence(c)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  cadence === c ? "border-accent bg-accent/10 text-accent" : "border-border-token text-text-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" checked={requiresReview} onChange={(e) => setRequiresReview(e.target.checked)} />
            Hold runs for editorial review before publishing
          </label>
          <Button className="ml-auto" disabled={busy !== null || !name || niche.length < 2} onClick={createRule}>
            {busy === "create" ? "Creating…" : "Create rule"}
          </Button>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </Card>

      {rules.length === 0 ? (
        <p className="text-sm text-text-muted">No rules yet — create one above.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule) => (
            <Card key={rule.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold">
                    {rule.name}
                    {rule.requiresReview ? <span className="ml-2 text-xs text-warning">review gate</span> : null}
                  </p>
                  <p className="text-xs text-text-muted">
                    {rule.niche} · {rule.cadence} · next run{" "}
                    {rule.nextRunAt ? new Date(rule.nextRunAt).toLocaleString() : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => showRuns(rule.id)}>
                    {expanded === rule.id ? "Hide runs" : "History"}
                  </Button>
                  <Button
                    variant={rule.enabled ? "secondary" : "primary"}
                    className="px-2.5 py-1 text-xs"
                    disabled={busy !== null}
                    onClick={() => toggle(rule)}
                  >
                    {busy === rule.id ? "…" : rule.enabled ? "Pause" : "Resume"}
                  </Button>
                </div>
              </div>
              {expanded === rule.id && (
                <div className="mt-2 flex flex-col gap-1.5 border-t border-border-token pt-3">
                  {(runs[rule.id] ?? []).length === 0 ? (
                    <p className="text-xs text-text-muted">No runs yet.</p>
                  ) : (
                    (runs[rule.id] ?? []).map((run) => (
                      <div key={run.id} className="flex items-center justify-between text-sm">
                        <span className="truncate">
                          {run.ideaTopic ?? "—"}
                          {run.error ? <span className="ml-2 text-xs text-danger">{run.error}</span> : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                          {run.creditsSpent != null ? `${run.creditsSpent} cr` : ""}
                          <StatusBadge status={run.status} />
                          {new Date(run.startedAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
