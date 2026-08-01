"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Skeleton, StatusBadge } from "@/components/ui";

interface Overview {
  orgs: Array<{ id: string; name: string; plan: string; cachedBalance: number; memberCount: number }>;
  users: Array<{ id: string; email: string; name: string | null; isStaff: boolean }>;
}

interface AdminJob {
  id: string;
  orgId: string;
  videoId: string | null;
  kind: string;
  status: string;
  stage: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
}

interface Flag {
  key: string;
  description: string | null;
  defaultOn: boolean;
}

/** Staff admin: orgs/users/balances (FAV-1701), job actions (FAV-1702), flags (FAV-1703). */
export default function AdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [q, setQ] = useState("");
  const [jobFilter, setJobFilter] = useState("failed");
  const [busy, setBusy] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    const [ovRes, jobsRes, flagsRes] = await Promise.all([
      fetch(`/api/admin/overview?q=${encodeURIComponent(q)}`, { cache: "no-store" }),
      fetch(`/api/admin/jobs${jobFilter === "all" ? "" : `?status=${jobFilter}`}`, { cache: "no-store" }),
      fetch("/api/admin/flags", { cache: "no-store" })
    ]);
    if (ovRes.status === 403 || ovRes.status === 401) {
      setDenied(true);
      return;
    }
    if (ovRes.ok) setOverview(await ovRes.json());
    if (jobsRes.ok) setJobs((await jobsRes.json()).jobs);
    if (flagsRes.ok) setFlags((await flagsRes.json()).flags);
  }, [q, jobFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function jobAction(id: string, action: "retry" | "refund") {
    setBusy(id + action);
    await fetch(`/api/admin/jobs/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
    setBusy(null);
    void load();
  }

  async function toggleFlag(flag: Flag) {
    setBusy(flag.key);
    await fetch("/api/admin/flags", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: flag.key, defaultOn: !flag.defaultOn })
    });
    setBusy(null);
    void load();
  }

  if (denied) {
    return <p className="text-danger">Staff access required.</p>;
  }
  if (!overview) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-sm text-text-muted">Operate the platform: orgs, jobs, flags.</p>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Organizations</h2>
          <Input className="max-w-xs" placeholder="Search orgs/users…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="overflow-hidden rounded-xl border border-border-token">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase text-text-muted">
              <tr>
                <th className="px-4 py-2">Org</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Members</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {overview.orgs.map((org) => (
                <tr key={org.id} className="border-t border-border-token">
                  <td className="px-4 py-2">
                    {org.name} <span className="text-xs text-text-muted">{org.id}</span>
                  </td>
                  <td className="px-4 py-2 capitalize">{org.plan}</td>
                  <td className="px-4 py-2">{org.memberCount}</td>
                  <td className="px-4 py-2 text-right font-medium">{org.cachedBalance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Jobs</h2>
          <div className="flex gap-1.5">
            {["failed", "running", "queued", "completed", "all"].map((s) => (
              <button
                key={s}
                onClick={() => setJobFilter(s)}
                className={`rounded-lg border px-2.5 py-1 text-xs capitalize ${
                  jobFilter === s ? "border-accent bg-accent/10 text-accent" : "border-border-token text-text-muted"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-text-muted">No {jobFilter === "all" ? "" : jobFilter} jobs.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {jobs.map((job) => (
              <Card key={job.id} className="flex items-center justify-between gap-4 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {job.kind} <span className="text-xs text-text-muted">{job.id}</span>
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {job.stage ? `stage: ${job.stage} · ` : ""}attempts: {job.attempts}
                    {job.error ? ` · ${job.error}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={job.status} />
                  {job.status === "failed" && (
                    <>
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1 text-xs"
                        disabled={busy !== null}
                        onClick={() => jobAction(job.id, "retry")}
                      >
                        {busy === job.id + "retry" ? "…" : "Retry"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2.5 py-1 text-xs"
                        disabled={busy !== null}
                        onClick={() => jobAction(job.id, "refund")}
                      >
                        {busy === job.id + "refund" ? "…" : "Refund"}
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Feature flags</h2>
        <div className="flex flex-col gap-2">
          {flags.map((flag) => (
            <Card key={flag.key} className="flex items-center justify-between p-3">
              <div>
                <p className="text-sm font-medium">{flag.key}</p>
                <p className="text-xs text-text-muted">{flag.description}</p>
              </div>
              <Button
                variant={flag.defaultOn ? "primary" : "secondary"}
                className="px-3 py-1 text-xs"
                disabled={busy !== null}
                onClick={() => toggleFlag(flag)}
              >
                {busy === flag.key ? "…" : flag.defaultOn ? "On" : "Off"}
              </Button>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
