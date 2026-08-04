"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@fav/core";

/** Switch between organizations the user belongs to (FAV-202). */
export function OrgSwitcher({
  current,
  memberships
}: {
  current: { id: string; name: string };
  memberships: Array<{ id: string; name: string; role: Role }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Nothing to switch between.
  if (memberships.length < 2) {
    return <span className="text-text-muted">{current.name}</span>;
  }

  return (
    <select
      className="rounded-lg border border-border-token bg-bg-elevated px-2 py-1 text-sm outline-none focus:border-accent"
      value={current.id}
      disabled={busy}
      aria-label="Active organization"
      onChange={async (e) => {
        setBusy(true);
        await fetch("/api/org/switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId: e.target.value })
        });
        setBusy(false);
        router.refresh();
      }}
    >
      {memberships.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({m.role})
        </option>
      ))}
    </select>
  );
}
