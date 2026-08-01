"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Card } from "@/components/ui";

function VerifyEmail() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("This link is missing its token.");
      return;
    }
    void fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    }).then(async (res) => {
      if (res.ok) {
        setState("ok");
        return;
      }
      setState("error");
      setError((await res.json().catch(() => ({}))).error ?? "Verification failed.");
    });
  }, [token]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card className="flex flex-col gap-4 text-center">
        {state === "working" && <p className="text-text-muted">Confirming your email…</p>}
        {state === "ok" && (
          <>
            <p className="text-lg font-semibold text-success">Email confirmed</p>
            <p className="text-sm text-text-muted">Your account is all set.</p>
            <Link href="/dashboard">
              <Button>Go to dashboard</Button>
            </Link>
          </>
        )}
        {state === "error" && (
          <>
            <p className="text-lg font-semibold text-danger">Couldn&apos;t confirm your email</p>
            <p className="text-sm text-text-muted">{error}</p>
            <Link href="/dashboard">
              <Button variant="secondary">Go to dashboard</Button>
            </Link>
          </>
        )}
      </Card>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
