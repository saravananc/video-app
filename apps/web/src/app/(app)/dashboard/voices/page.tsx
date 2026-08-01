"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Input, Skeleton } from "@/components/ui";

interface Voice {
  id: string;
  name: string;
  description: string | null;
  language: string;
  gender: string | null;
  isClone: boolean;
  status: string;
  previewUrl: string;
}

/** Voice library + clone management (FAV-602/603/1106). */
export default function VoicesPage() {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("all");
  const [cloneName, setCloneName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/voices", { cache: "no-store" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Failed to load voices");
      return;
    }
    const body = await res.json();
    setVoices(body.voices);
    setDefaultVoiceId(body.defaultVoiceId);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function preview(url: string) {
    if (audioRef.current) audioRef.current.pause();
    audioRef.current = new Audio(url);
    void audioRef.current.play();
  }

  async function setDefault(id: string) {
    setBusy(id);
    await fetch(`/api/voices/${id}`, { method: "PUT" });
    setBusy(null);
    void load();
  }

  async function removeClone(id: string) {
    setBusy(id);
    await fetch(`/api/voices/${id}`, { method: "DELETE" });
    setBusy(null);
    void load();
  }

  async function createClone() {
    setBusy("clone");
    setError(null);
    // Demo sample: a generated WAV stands in for a mic recording in the sandbox.
    const sampleRes = await fetch("/api/voices", { cache: "no-store" });
    const anyVoice = (await sampleRes.json()).voices[0] as Voice | undefined;
    let sampleBase64 = "";
    if (anyVoice) {
      const audio = await fetch(anyVoice.previewUrl);
      const buf = new Uint8Array(await audio.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      sampleBase64 = btoa(bin);
    }
    const res = await fetch("/api/voices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: cloneName, sampleBase64 })
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json()).error ?? "Clone failed");
      return;
    }
    setCloneName("");
    void load();
  }

  if (!voices) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const languages = ["all", ...new Set(voices.map((v) => v.language))];
  const filtered = voices.filter(
    (v) =>
      (language === "all" || v.language === language) &&
      (search === "" || v.name.toLowerCase().includes(search.toLowerCase()))
  );
  const clones = voices.filter((v) => v.isClone);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Voices</h1>
        <p className="text-sm text-text-muted">Browse the library, preview, clone, and set your default.</p>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search voices…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1.5">
          {languages.map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguage(lang)}
              className={`rounded-lg border px-2.5 py-1 text-xs uppercase ${
                language === lang ? "border-accent bg-accent/10 text-accent" : "border-border-token text-text-muted"
              }`}
            >
              {lang}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((voice) => (
          <Card key={voice.id} className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">
                {voice.name}
                {voice.isClone ? <span className="ml-2 text-xs text-accent">clone</span> : null}
                {defaultVoiceId === voice.id ? <span className="ml-2 text-xs text-success">default</span> : null}
              </p>
              <span className="text-xs uppercase text-text-muted">{voice.language}</span>
            </div>
            <p className="text-xs text-text-muted">{voice.description}</p>
            <div className="mt-1 flex gap-2">
              <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => preview(voice.previewUrl)}>
                ▶ Preview
              </Button>
              {defaultVoiceId !== voice.id && (
                <Button
                  variant="ghost"
                  className="px-2.5 py-1 text-xs"
                  disabled={busy !== null}
                  onClick={() => setDefault(voice.id)}
                >
                  Set default
                </Button>
              )}
              {voice.isClone && (
                <Button
                  variant="ghost"
                  className="px-2.5 py-1 text-xs text-danger"
                  disabled={busy !== null}
                  onClick={() => removeClone(voice.id)}
                >
                  Delete
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Clone your voice</h2>
          <p className="text-sm text-text-muted">
            {clones.length > 0
              ? `You have ${clones.length} clone${clones.length === 1 ? "" : "s"}.`
              : "Create a voice clone from a short sample — stored encrypted, usable like any library voice."}
          </p>
        </div>
        <div className="flex gap-3">
          <Input
            className="max-w-xs"
            placeholder="Clone name (e.g. My voice)"
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
          />
          <Button disabled={busy !== null || cloneName.trim().length === 0} onClick={createClone}>
            {busy === "clone" ? "Cloning…" : "Create clone (demo sample)"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
