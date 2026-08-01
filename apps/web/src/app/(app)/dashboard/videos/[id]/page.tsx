"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, ProgressBar, Skeleton, StatusBadge } from "@/components/ui";

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
    status: string;
    imageUrl: string | null;
  }>;
}

const TERMINAL = new Set(["completed", "failed", "canceled"]);

/** Real-time progress + playback + download (FAV-1104/1105/1004). */
export default function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<VideoDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
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
    timer.current = setInterval(async () => {
      const body = await load();
      if (body && TERMINAL.has(body.video.status) && timer.current) {
        clearInterval(timer.current);
      }
    }, 2500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

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
          <ProgressBar
            percent={job?.progress?.percent ?? 0}
            label={job?.progress?.stageLabel ?? "Starting…"}
          />
          {job?.progress?.detail ? (
            <p className="mt-2 text-xs text-text-muted">{job.progress.detail}</p>
          ) : null}
        </Card>
      )}

      {video.status === "failed" && (
        <Card className="border-danger/40 bg-danger/5">
          <p className="font-medium text-danger">Generation failed — credits refunded</p>
          <p className="mt-1 text-sm text-text-muted">{video.errorMessage ?? job?.error ?? "Unknown error"}</p>
          <Link href="/dashboard/new">
            <Button variant="secondary" className="mt-3">
              Try a different topic
            </Button>
          </Link>
        </Card>
      )}

      {video.status === "completed" && video.finalUrl && (
        <Card className="flex flex-col items-center gap-4">
          <video
            src={video.finalUrl}
            controls
            className="max-h-[70vh] rounded-lg border border-border-token bg-black"
          />
          <div className="flex items-center gap-3">
            <a href={video.finalUrl} download={`${video.title.replace(/[^\w-]+/g, "_")}.mp4`}>
              <Button>Download MP4</Button>
            </a>
            <p className="text-sm text-text-muted">
              {video.durationSeconds ? `${Math.round(video.durationSeconds)}s` : ""} ·{" "}
              {video.creditsCharged ?? video.creditsEstimated} credits
            </p>
          </div>
        </Card>
      )}

      {scenes.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Scenes</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {scenes.map((scene) => (
              <Card key={scene.id} className="flex flex-col gap-2 p-3">
                {scene.imageUrl ? (
                  <img
                    src={scene.imageUrl}
                    alt={`Scene ${scene.index + 1}`}
                    className="aspect-[9/16] w-full rounded-md object-cover"
                  />
                ) : (
                  <div className="flex aspect-[9/16] w-full items-center justify-center rounded-md bg-bg-subtle">
                    <StatusBadge status={scene.status} />
                  </div>
                )}
                <p className="line-clamp-3 text-xs text-text-muted">
                  <span className="font-medium text-text">#{scene.index + 1}</span> {scene.narration}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
