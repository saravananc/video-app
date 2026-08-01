"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";

function ResetPassword() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/password-reset", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password })
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Reset failed.");
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 1500);
  }

  if (!token) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <Card className="text-center">
          <p className="text-danger">This reset link is missing its token.</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card className="flex flex-col gap-4">
        <div className="text-center">
          <p className="text-lg font-semibold">Choose a new password</p>
          <p className="text-sm text-text-muted">At least 10 characters.</p>
        </div>
        {done ? (
          <p className="text-center text-sm text-success">Password updated — taking you to sign in…</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Input
              type="password"
              required
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Input
              type="password"
              required
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <Button type="submit" disabled={busy || !password}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
        {error ? <p className="text-center text-sm text-danger">{error}</p> : null}
      </Card>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}
