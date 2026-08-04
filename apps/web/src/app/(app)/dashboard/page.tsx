import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { VideoList } from "./video-list";

export const dynamic = "force-dynamic";

/** Dashboard / video list (FAV-1101). */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your videos</h1>
          <p className="text-sm text-text-muted">Everything {session.org.name} has generated.</p>
        </div>
        <Link
          href="/dashboard/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          + New video
        </Link>
      </div>
      <VideoList />
    </div>
  );
}
