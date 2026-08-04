"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { VIDEO_STATUSES, type VideoStatus } from "@fav/core";
import { Button, EmptyState, Input, Skeleton, StatusBadge } from "@/components/ui";

interface VideoRow {
  id: string;
  title: string;
  topic: string;
  status: string;
  durationSeconds: number | null;
  creditsCharged: number | null;
  createdAt: string;
}

const FILTERS: Array<{ value: "" | VideoStatus; label: string }> = [
  { value: "", label: "All" },
  ...VIDEO_STATUSES.filter((s) => s !== "canceled").map((s) => ({
    value: s,
    label: s.charAt(0).toUpperCase() + s.slice(1)
  }))
];

/** Dashboard list with filter, search, sort, and pagination (FAV-1101). */
export function VideoList() {
  const [rows, setRows] = useState<VideoRow[] | null>(null);
  const [status, setStatus] = useState<"" | VideoStatus>("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [prevCursors, setPrevCursors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ sort });
    if (status) params.set("status", status);
    if (debounced) params.set("q", debounced);
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/videos?${params}`, { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setRows(body.videos);
      setNextCursor(body.nextCursor);
    }
    setLoading(false);
  }, [status, sort, debounced, cursor]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter change invalidates the cursor trail.
  function changeFilter(next: Partial<{ status: "" | VideoStatus; sort: "newest" | "oldest" }>) {
    if (next.status !== undefined) setStatus(next.status);
    if (next.sort !== undefined) setSort(next.sort);
    setCursor(null);
    setPrevCursors([]);
  }

  if (rows === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const filtersActive = status !== "" || debounced !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value || "all"}
              onClick={() => changeFilter({ status: f.value })}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                status === f.value
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border-token text-text-muted hover:text-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input
          className="max-w-xs"
          placeholder="Search title or topic…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCursor(null);
            setPrevCursors([]);
          }}
        />
        <button
          className="ml-auto text-xs text-text-muted hover:text-text"
          onClick={() => changeFilter({ sort: sort === "newest" ? "oldest" : "newest" })}
        >
          Sort: {sort === "newest" ? "Newest first" : "Oldest first"} ⇅
        </button>
      </div>

      {rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title="No matching videos"
            description="Try a different status or search term."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  changeFilter({ status: "" });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Create your first video"
            description="Type a topic and FAV generates the script, visuals, voiceover, captions, and the final render."
            action={
              <Link
                href="/dashboard/new"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
              >
                New video
              </Link>
            }
          />
        )
      ) : (
        <>
          <div className={`overflow-hidden rounded-xl border border-border-token ${loading ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-4 py-3">Video</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Credits</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="border-t border-border-token transition-colors hover:bg-bg-subtle/50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/videos/${v.id}`} className="font-medium hover:text-accent">
                        {v.title}
                      </Link>
                      <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{v.topic}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={v.status} />
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {v.durationSeconds ? `${Math.round(v.durationSeconds)}s` : "—"}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{v.creditsCharged ?? "—"}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {new Date(v.createdAt).toLocaleString(undefined, {
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

          {(prevCursors.length > 0 || nextCursor) && (
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                disabled={prevCursors.length === 0 || loading}
                onClick={() => {
                  const trail = [...prevCursors];
                  // "" is the sentinel for page 1, which has no cursor.
                  const previous = trail.pop() || null;
                  setPrevCursors(trail);
                  setCursor(previous);
                }}
              >
                ← Previous
              </Button>
              <span className="text-xs text-text-muted">Page {prevCursors.length + 1}</span>
              <Button
                variant="secondary"
                disabled={!nextCursor || loading}
                onClick={() => {
                  setPrevCursors([...prevCursors, cursor ?? ""]);
                  setCursor(nextCursor);
                }}
              >
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
