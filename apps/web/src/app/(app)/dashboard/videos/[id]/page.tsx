"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, ProgressBar, Skeleton, StatusBadge } from "@/components/ui";
import { SceneEditor } from "./scene-editor";
import { PublishPanel } from "./publish-panel";

interface VideoDetail {
  video: {
    id: string;
    title: string;
    topic: string;
    status: string;
    durationSeconds: number | null;
    creditsEstimated: number | null;
    creditsCharged: number | null;
    errorMessage: string | null;
    finalUrl: string | null;
  };
  job: {
    status: string;
    error: string | null;
    progress: { stageLabel: string; percent: number; detail: string | null } | null;
  } | null;
  scenes: Array<{
    id: string;
    index: number;
    narration: string;
    visualPrompt: string;
    onScreenText: string | null;
    status: string;
    imageUrl: string | null;
  }>;
}

const TERMINAL = new Set(["completed", "failed", "canceled", "draft"]);

/** Video detail: progress (FAV-1104), player + download (FAV-1105), scene editor
 * (FAV-1103), and publishing (FAV-1302). */
export default function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<VideoDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [rerenderBusy, setRerenderBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/videos/${id}`, { cache: "no-store" });
    if (res.status === 404) {
      setNotFound(true);
      return null;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as VideoDetail;
    setData(body);
    return body;
  }, [id]);

  useEffect(() => {
    void load();
    timer.current = setInterval(load, 2500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  async function rerender(fullScript = false) {
    setRerenderBusy(true);
    await fetch(`/api/videos/${id}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullScript })
    });
    setRerenderBusy(false);
    void load();
  }

  if (notFound) {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold">Video not found</p>
        <Link href="/dashboard" className="text-sm text-accent">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { video, job, scenes } = data;
  const generating = !TERMINAL.has(video.status);
  const editable = TERMINAL.has(video.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-xs text-text-muted hover:text-text">
            ← All videos
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{video.title}</h1>
          <p className="mt-0.5 text-sm text-text-muted">{video.topic}</p>
        </div>
        <StatusBadge status={video.status} />
      </div>

      {generating && (
        <Card>
          <ProgressBar percent={job?.progress?.percent ?? 0} label={job?.progress?.stageLabel ?? "Starting…"} />
          {job?.progress?.detail ? <p className="mt-2 text-xs text-text-muted">{job.progress.detail}</p> : null}
        </Card>
      )}

      {video.status === "failed" && (
        <Card className="border-danger/40 bg-danger/5">
          <p className="font-medium text-danger">Generation failed — credits refunded</p>
          <p className="mt-1 text-sm text-text-muted">{video.errorMessage ?? job?.error ?? "Unknown error"}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" disabled={rerenderBusy} onClick={() => rerender(false)}>
              Retry
            </Button>
            <Link href="/dashboard/new">
              <Button variant="ghost">Try a different topic</Button>
            </Link>
          </div>
        </Card>
      )}

      {video.status === "draft" && (
        <Card className="border-warning/40 bg-warning/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium">Changes pending</p>
              <p className="text-sm text-text-muted">
                Your edits are saved. Re-render to bake them into a new video — only the changed pieces regenerate.
              </p>
            </div>
            <Button disabled={rerenderBusy} onClick={() => rerender(false)}>
              {rerenderBusy ? "Starting…" : "Apply & re-render"}
            </Button>
          </div>
        </Card>
      )}

      {video.status === "completed" && video.finalUrl && (
        <Card className="flex flex-col items-center gap-4">
          <video src={video.finalUrl} controls className="max-h-[70vh] rounded-lg border border-border-token bg-black" />
          <div className="flex items-center gap-3">
            <a href={video.finalUrl} download={`${video.title.replace(/[^\w-]+/g, "_")}.mp4`}>
              <Button>Download MP4</Button>
            </a>
            <Button
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(video.finalUrl!)}
              title="Copy signed link"
            >
              Copy link
            </Button>
            <p className="text-sm text-text-muted">
              {video.durationSeconds ? `${Math.round(video.durationSeconds)}s` : ""} ·{" "}
              {video.creditsCharged ?? video.creditsEstimated} credits
            </p>
          </div>
        </Card>
      )}

      {video.status === "completed" && <PublishPanel videoId={video.id} defaultTitle={video.title} />}

      {scenes.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Scenes</h2>
            {editable && (
              <Button variant="ghost" disabled={rerenderBusy} onClick={() => rerender(true)}>
                Regenerate whole script
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {scenes.map((scene) => (
              <SceneEditor key={scene.id} videoId={video.id} scene={scene} editable={editable} onChanged={load} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
