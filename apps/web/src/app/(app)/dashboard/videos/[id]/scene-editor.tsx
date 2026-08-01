"use client";

import { useState } from "react";
import { Button, Card, StatusBadge, Textarea } from "@/components/ui";

interface SceneData {
  id: string;
  index: number;
  narration: string;
  visualPrompt: string;
  onScreenText: string | null;
  status: string;
  imageUrl: string | null;
}

/** Per-scene inline edit + re-roll (FAV-1103/404/505). */
export function SceneEditor({
  videoId,
  scene,
  editable,
  onChanged
}: {
  videoId: string;
  scene: SceneData;
  editable: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [narration, setNarration] = useState(scene.narration);
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt);
  const [busy, setBusy] = useState<"save" | "reroll" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy("save");
    setError(null);
    const res = await fetch(`/api/videos/${videoId}/scenes/${scene.index}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(narration !== scene.narration ? { narration } : {}),
        ...(visualPrompt !== scene.visualPrompt ? { visualPrompt } : {})
      })
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "Save failed");
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function reroll() {
    setBusy("reroll");
    setError(null);
    const res = await fetch(`/api/videos/${videoId}/scenes/${scene.index}/reroll`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "Re-roll failed");
      return;
    }
    onChanged();
  }

  return (
    <Card className="flex flex-col gap-2 p-3">
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

      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-text-muted">Narration</label>
          <Textarea rows={3} value={narration} onChange={(e) => setNarration(e.target.value)} />
          <label className="text-xs font-medium text-text-muted">Visual prompt</label>
          <Textarea rows={2} value={visualPrompt} onChange={(e) => setVisualPrompt(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 px-2 py-1 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button className="flex-1 px-2 py-1 text-xs" disabled={busy !== null} onClick={save}>
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="line-clamp-3 text-xs text-text-muted">
            <span className="font-medium text-text">#{scene.index + 1}</span> {scene.narration}
          </p>
          {editable && (
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1 px-2 py-1 text-xs" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                className="flex-1 px-2 py-1 text-xs"
                disabled={busy !== null}
                onClick={reroll}
                title="Regenerate this scene's visual (charges re-roll credits)"
              >
                {busy === "reroll" ? "Re-rolling…" : "Re-roll"}
              </Button>
            </div>
          )}
        </>
      )}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </Card>
  );
}
