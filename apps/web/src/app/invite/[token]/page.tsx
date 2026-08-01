"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";

/** Invite acceptance page (FAV-205): invitee joins the existing org. */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/org/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    });
    setBusy(false);
    if (res.status === 401) {
      router.push(`/login?next=/invite/${token}`);
      return;
    }
    if (!res.ok) {
      setError((await res.json()).error ?? "Could not accept invite");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Card className="flex flex-col gap-4 text-center">
        <p className="text-lg font-semibold">You've been invited to a team</p>
        <p className="text-sm text-text-muted">
          Accept to join the organization. If you don't have an account yet, you'll sign up first.
        </p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button disabled={busy} onClick={accept}>
          {busy ? "Joining…" : "Accept invite"}
        </Button>
      </Card>
    </main>
  );
}
