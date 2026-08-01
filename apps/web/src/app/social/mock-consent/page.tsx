"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card } from "@/components/ui";

/**
 * Dev-only fake OAuth consent screen (mock publisher). "Allow" redirects back
 * to the real callback with the code + state, exercising the entire connect flow.
 */
function MockConsent() {
  const params = useSearchParams();
  const platform = params.get("platform") ?? "youtube";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";

  const allowUrl = `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card className="flex flex-col gap-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-warning">
          Test consent screen — no real account
        </p>
        <p className="text-lg font-semibold capitalize">Connect {platform}?</p>
        <p className="text-sm text-text-muted">
          FAV Studio wants permission to upload videos to your {platform} account.
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={() => window.close()}>
            Deny
          </Button>
          <Button onClick={() => (window.location.href = allowUrl)}>Allow</Button>
        </div>
      </Card>
    </main>
  );
}

export default function MockConsentPage() {
  return (
    <Suspense>
      <MockConsent />
    </Suspense>
  );
}
