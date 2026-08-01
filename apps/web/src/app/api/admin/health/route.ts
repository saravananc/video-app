import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, jobs } from "@fav/db";
import { breakerHealth } from "@fav/providers";
import { authErrorResponse } from "@/lib/org";
import { requireStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

/**
 * Ops health snapshot (FAV-1608): queue depth, provider breaker states, and
 * recent failure counts. ALERT_WEBHOOK_URL receives a POST when thresholds
 * trip — point it at Slack/PagerDuty in production.
 */
export async function GET() {
  try {
    await requireStaff();
    const db = getDb();
    const [queued] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(eq(jobs.status, "queued"));
    const [running] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(eq(jobs.status, "running"));
    const [recentFailures] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(sql`${jobs.status} = 'failed' and ${jobs.finishedAt} > now() - interval '1 hour'`);

    const health = {
      queueDepth: queued?.count ?? 0,
      running: running?.count ?? 0,
      failuresLastHour: recentFailures?.count ?? 0,
      breakers: breakerHealth(),
      alerts: [] as string[]
    };
    if (health.queueDepth > 25) health.alerts.push(`Queue backlog: ${health.queueDepth} jobs`);
    if (health.failuresLastHour > 10) health.alerts.push(`Error spike: ${health.failuresLastHour} failures/h`);
    for (const b of health.breakers) {
      if (b.state === "open") health.alerts.push(`Provider outage: ${b.name} breaker open`);
    }

    if (health.alerts.length > 0 && process.env.ALERT_WEBHOOK_URL) {
      void fetch(process.env.ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `FAV alerts: ${health.alerts.join("; ")}` })
      }).catch(() => undefined);
    }

    return NextResponse.json(health);
  } catch (err) {
    const auth = authErrorResponse(err);
    if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    throw err;
  }
}
