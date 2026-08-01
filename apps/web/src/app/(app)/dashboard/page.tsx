import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, videos } from "@fav/db";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { EmptyState, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Dashboard / video list (FAV-1101): all videos with status in one place. */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const rows = await getDb()
    .select({
      id: videos.id,
      title: videos.title,
      topic: videos.topic,
      status: videos.status,
      durationSeconds: videos.durationSeconds,
      creditsCharged: videos.creditsCharged,
      createdAt: videos.createdAt
    })
    .from(videos)
    .where(eq(videos.orgId, session.orgId))
    .orderBy(desc(videos.createdAt))
    .limit(50);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your videos</h1>
          <p className="text-sm text-text-muted">
            {rows.length === 0 ? "Nothing here yet" : `${rows.length} video${rows.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link
          href="/dashboard/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          + New video
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Create your first video"
          description="Type a topic and FAV generates the script, visuals, voiceover, captions, and the final render."
          action={
            <Link
              href="/dashboard/new"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              New video
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-token">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-3">Video</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Credits</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-t border-border-token transition-colors hover:bg-bg-subtle/50">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/videos/${v.id}`} className="font-medium hover:text-accent">
                      {v.title}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{v.topic}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {v.durationSeconds ? `${Math.round(v.durationSeconds)}s` : "—"}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{v.creditsCharged ?? "—"}</td>
                  <td className="px-4 py-3 text-text-muted">
                    {new Date(v.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
