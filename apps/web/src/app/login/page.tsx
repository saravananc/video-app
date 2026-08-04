"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";

type Mode = "login" | "signup";

interface AuthConfig {
  provider: "local" | "clerk";
  signInUrl: string | null;
  signUpUrl: string | null;
}

function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Don't offer a password form the API will reject when Clerk owns identity.
    void fetch("/api/auth/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setConfig(body ?? { provider: "local", signInUrl: null, signUpUrl: null }));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        mode === "login" ? { email, password } : { email, password, name: name || undefined }
      )
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function forgotPassword() {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    setError(null);
    await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    setBusy(false);
    setNotice("If that address has an account, a reset link is on its way.");
  }

  // Clerk owns identity: send people to its hosted pages rather than showing a
  // password form that /api/auth/login would refuse.
  if (config?.provider === "clerk") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            <span className="text-accent">FAV</span> Studio
          </h1>
          <p className="mt-1 text-sm text-text-muted">Sign in to create faceless videos</p>
        </div>
        <Card className="flex flex-col gap-3 text-center">
          {config.signInUrl ? (
            <>
              <a href={`${config.signInUrl}?redirect_url=${encodeURIComponent(next)}`}>
                <Button className="w-full">Sign in</Button>
              </a>
              {config.signUpUrl ? (
                <a href={config.signUpUrl} className="text-sm text-accent hover:underline">
                  Create an account
                </a>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-danger">
              Clerk is enabled but no sign-in URL is configured. Set
              <code className="mx-1 text-xs">NEXT_PUBLIC_CLERK_SIGN_IN_URL</code>.
            </p>
          )}
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">
          <span className="text-accent">FAV</span> Studio
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {mode === "login" ? "Sign in to create faceless videos" : "Create an account — starter credits included"}
        </p>
      </div>

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <Input placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <Input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="password"
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder={mode === "login" ? "Password" : "Password (at least 10 characters)"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" disabled={busy || !email || !password}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="mt-3 flex items-center justify-between text-sm">
          <button
            className="text-accent hover:underline"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "login" ? "Create an account" : "I already have an account"}
          </button>
          {mode === "login" && (
            <button className="text-text-muted hover:text-text" disabled={busy} onClick={forgotPassword}>
              Forgot password?
            </button>
          )}
        </div>
      </Card>

      {error ? <p className="text-center text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-center text-sm text-success">{notice}</p> : null}

      <p className="text-center text-xs text-text-muted">
        Development seed accounts: owner@demo.fav / admin@demo.fav / member@demo.fav
        <br />
        password <code>demo-password-123</code> —{" "}
        <Link href="/" className="hover:text-text">
          back to home
        </Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}
