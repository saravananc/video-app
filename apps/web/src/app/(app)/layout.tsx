import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, resolveFlags } from "@fav/db";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
import { OrgSwitcher } from "@/components/org-switcher";

/** Authenticated app shell: nav with org, balance, and sign-out (FAV-204). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  // Nav only shows features enabled for this org (FAV-1703).
  const flags = await resolveFlags(getDb(), session.orgId);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border-token bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-bold tracking-tight">
              <span className="text-accent">FAV</span> Studio
            </Link>
            <nav className="flex items-center gap-4 text-sm text-text-muted">
              <Link href="/dashboard" className="transition-colors hover:text-text">
                Videos
              </Link>
              <Link href="/dashboard/voices" className="transition-colors hover:text-text">
                Voices
              </Link>
              <Link href="/dashboard/social" className="transition-colors hover:text-text">
                Social
              </Link>
              {flags.autopilot ? (
                <Link href="/dashboard/autopilot" className="transition-colors hover:text-text">
                  Autopilot
                </Link>
              ) : null}
              {flags.public_api ? (
                <Link href="/dashboard/api-keys" className="transition-colors hover:text-text">
                  API
                </Link>
              ) : null}
              <Link href="/billing" className="transition-colors hover:text-text">
                Billing
              </Link>
              {session.user.isStaff ? (
                <Link href="/admin" className="transition-colors hover:text-text">
                  Admin
                </Link>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/billing"
              className="rounded-full border border-border-token bg-bg-elevated px-3 py-1 font-medium"
              title="Credit balance"
            >
              {session.org.cachedBalance} credits
            </Link>
            <OrgSwitcher current={session.org} memberships={session.memberships} />
            <span className="text-text-muted">{session.user.name ?? session.user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
