"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  estimateVideoCost,
  videoRequestSchema,
  type AspectRatio,
  type CaptionStyle,
  type QualityTier,
  type Resolution,
  type Tone,
  type VisualStyle
} from "@fav/core";
import { Button, Card, PillGroup, Textarea } from "@/components/ui";

/** New-video wizard (FAV-1102): topic -> look & feel -> confirm with estimate. */
export default function NewVideoPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [topic, setTopic] = useState("");
  const [durationSeconds, setDuration] = useState(60);
  const [tier, setTier] = useState<QualityTier>("basic");
  const [aspectRatio, setAspect] = useState<AspectRatio>("9:16");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("cinematic");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("bold");
  const [tone, setTone] = useState<Tone>("informative");
  const [voiceId, setVoiceId] = useState("voice_adam");

  const request = useMemo(
    () =>
      videoRequestSchema.parse({
        topic: topic || "placeholder topic",
        durationSeconds,
        tier,
        aspectRatio,
        resolution,
        visualStyle,
        captionStyle,
        tone,
        voiceId
      }),
    [topic, durationSeconds, tier, aspectRatio, resolution, visualStyle, captionStyle, tone, voiceId]
  );
  // Same cost table the server charges from (FAV-1207), so the estimate never lies.
  const estimate = useMemo(() => estimateVideoCost(request), [request]);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    setBusy(false);
    const body = await res.json();
    if (res.status === 402) {
      setError(`Not enough credits: this video needs ${body.required} but you have ${body.available}. Top up in Billing.`);
      return;
    }
    if (!res.ok) {
      setError(body.error ?? "Something went wrong");
      return;
    }
    router.push(`/dashboard/videos/${body.videoId}`);
  }

  const steps = ["Topic", "Look & sound", "Confirm"];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">New video</h1>
        <div className="mt-3 flex gap-2">
          {steps.map((label, i) => (
            <button
              key={label}
              onClick={() => i < step && setStep(i)}
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                i === step
                  ? "bg-accent text-accent-fg"
                  : i < step
                    ? "bg-accent/15 text-accent"
                    : "bg-bg-subtle text-text-muted"
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>
      </div>

      {step === 0 && (
        <Card className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">What should the video be about?</label>
            <Textarea
              rows={3}
              placeholder="e.g. why the deep ocean remains unexplored"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Target length</label>
            <PillGroup
              options={[
                { value: "30", label: "30s" },
                { value: "60", label: "60s" },
                { value: "120", label: "2 min" },
                { value: "300", label: "5 min" }
              ]}
              value={String(durationSeconds) as "30" | "60" | "120" | "300"}
              onChange={(v) => setDuration(Number(v))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Tone</label>
            <PillGroup
              options={(
                ["informative", "dramatic", "casual", "inspirational", "humorous", "mysterious"] as Tone[]
              ).map((t) => ({ value: t, label: t }))}
              value={tone}
              onChange={setTone}
            />
          </div>
          <Button className="self-end" disabled={topic.trim().length < 3} onClick={() => setStep(1)}>
            Continue
          </Button>
        </Card>
      )}

      {step === 1 && (
        <Card className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Quality tier</label>
            <PillGroup
              options={[
                { value: "basic", label: "Basic — fast images" },
                { value: "premium", label: "Premium — detailed images" },
                { value: "max", label: "Max — motion clips" }
              ]}
              value={tier}
              onChange={setTier}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Format</label>
            <PillGroup
              options={[
                { value: "9:16", label: "Vertical (Shorts/Reels/TikTok)" },
                { value: "16:9", label: "Horizontal (YouTube)" }
              ]}
              value={aspectRatio}
              onChange={setAspect}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Resolution</label>
            <PillGroup
              options={[
                { value: "1080p", label: "1080p" },
                { value: "4k", label: "4K" }
              ]}
              value={resolution}
              onChange={setResolution}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Visual style</label>
            <PillGroup
              options={(
                ["cinematic", "anime", "3d", "watercolor", "photorealistic", "minimalist"] as VisualStyle[]
              ).map((s) => ({ value: s, label: s }))}
              value={visualStyle}
              onChange={setVisualStyle}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Captions</label>
            <PillGroup
              options={(["bold", "karaoke", "impact", "clean", "none"] as CaptionStyle[]).map((s) => ({
                value: s,
                label: s
              }))}
              value={captionStyle}
              onChange={setCaptionStyle}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Voice</label>
            <PillGroup
              options={[
                { value: "voice_adam", label: "Adam — deep narrator" },
                { value: "voice_bella", label: "Bella — warm storyteller" },
                { value: "voice_josh", label: "Josh — energetic" }
              ]}
              value={voiceId as "voice_adam" | "voice_bella" | "voice_josh"}
              onChange={setVoiceId}
            />
          </div>
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button onClick={() => setStep(2)}>Continue</Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-text-muted">Topic</p>
            <p className="font-medium">{topic}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["Length", `${durationSeconds}s`],
              ["Tier", tier],
              ["Format", `${aspectRatio} · ${resolution}`],
              ["Style", `${visualStyle} · ${captionStyle} captions`]
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-bg-subtle p-3">
                <p className="text-xs text-text-muted">{k}</p>
                <p className="font-medium capitalize">{v}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
            <p className="mb-2 text-sm font-semibold">Estimated cost: {estimate.total} credits</p>
            <div className="grid grid-cols-5 gap-2 text-center text-xs text-text-muted">
              {(
                [
                  ["Script", estimate.script],
                  ["Visuals", estimate.visuals],
                  ["Voice", estimate.voice],
                  ["Captions", estimate.captions],
                  ["Render", estimate.render]
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <p className="font-medium text-text">{v}</p>
                  <p>{k}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              You're only charged for what's actually generated — failures are refunded automatically.
            </p>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={busy} onClick={submit}>
              {busy ? "Starting…" : `Generate video (${estimate.total} credits)`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
