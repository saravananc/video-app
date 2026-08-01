"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button, Card, Input } from "@/components/ui";

const DEMO_USERS = [
  { email: "owner@demo.fav", name: "Demo Owner", role: "Owner" },
  { email: "admin@demo.fav", name: "Demo Admin", role: "Admin" },
  { email: "member@demo.fav", name: "Demo Member", role: "Member" }
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  async function login(userEmail: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: userEmail })
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Login failed");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: name || undefined })
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "Signup failed");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">
          <span className="text-accent">FAV</span> Studio
        </h1>
        <p className="mt-1 text-sm text-text-muted">Sign in to create faceless videos</p>
      </div>

      <Card>
        <p className="mb-3 text-sm font-medium">Demo accounts</p>
        <div className="flex flex-col gap-2">
          {DEMO_USERS.map((u) => (
            <button
              key={u.email}
              disabled={busy}
              onClick={() => login(u.email)}
              className="flex items-center justify-between rounded-lg border border-border-token px-4 py-2.5 text-left text-sm transition-colors hover:border-accent hover:bg-accent/5"
            >
              <span>
                <span className="font-medium">{u.name}</span>
                <span className="ml-2 text-text-muted">{u.email}</span>
              </span>
              <span className="text-xs text-text-muted">{u.role}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <p className="mb-3 text-sm font-medium">Or create a new account</p>
        <form onSubmit={signup} className="flex flex-col gap-3">
          <Input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={busy || !email}>
            Create account — free starter credits included
          </Button>
        </form>
      </Card>

      {error ? <p className="text-center text-sm text-danger">{error}</p> : null}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
