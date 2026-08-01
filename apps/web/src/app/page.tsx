import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <span className="rounded-full border border-border-token bg-bg-subtle px-3 py-1 text-xs text-text-muted">
        FAV — Faceless AI Video
      </span>
      <h1 className="text-5xl font-bold tracking-tight">
        Type a topic.
        <br />
        <span className="text-accent">Get a finished video.</span>
      </h1>
      <p className="max-w-xl text-lg text-text-muted">
        Script, visuals, voiceover, word-synced captions, and a rendered MP4 — generated end-to-end
        while you watch the progress bar.
      </p>
      <div className="flex gap-3">
        <Link
          href="/dashboard"
          className="rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          Open dashboard
        </Link>
        <Link
          href="/dashboard/new"
          className="rounded-lg border border-border-token bg-bg-elevated px-5 py-2.5 font-medium transition-colors hover:bg-bg-subtle"
        >
          Create a video
        </Link>
      </div>
    </main>
  );
}
