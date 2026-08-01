import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants";

/**
 * next.config runs in plain Node (never bundled), so it's the one place we can
 * run migrations + seed at server startup without webpack interfering with
 * PGlite/drizzle file resolution. Build phase skips it.
 */
/**
 * Secrets that must be explicitly set in production. Checked at boot so a
 * misconfigured deploy fails immediately and visibly, rather than serving
 * traffic until the first request that happens to need one.
 */
const REQUIRED_IN_PRODUCTION = [
  "FAV_SESSION_SECRET",
  "FAV_ENCRYPTION_KEY",
  "FAV_STORAGE_SIGNING_SECRET",
  "DATABASE_URL"
];

export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) {
    if (process.env.NODE_ENV === "production" && process.env.FAV_ALLOW_INSECURE_DEFAULTS !== "1") {
      const missing = REQUIRED_IN_PRODUCTION.filter((key) => !process.env[key]);
      if (missing.length > 0) {
        throw new Error(
          `Missing required production configuration: ${missing.join(", ")}. ` +
            "Set them, or FAV_ALLOW_INSECURE_DEFAULTS=1 to run with development defaults (never in production)."
        );
      }
    }

    const { getDb, runMigrations, seed } = await import("@fav/db");
    const db = getDb();
    await runMigrations(db);
    if (process.env.FAV_AUTO_SEED !== "0") {
      await seed(db);
    }

    // Start the embedded worker + schedulers here rather than from a layout:
    // this runs once per server process and only in the serving phases, so the
    // build never spins up a worker.
    //
    // In production run apps/worker as a separate pool with
    // FAV_EMBEDDED_WORKER=0, and FAV_SCHEDULERS=0 with external crons hitting
    // /api/autopilot/sweep and /api/admin/maintenance, so sweeps fire once
    // across the fleet instead of once per web instance.
    const { defaultDeps, startWorker, sweepDueAutopilotRules, runMaintenance } = await import("@fav/workflows");
    const { getStorageProvider } = await import("@fav/providers");

    if (process.env.FAV_EMBEDDED_WORKER !== "0") {
      const worker = startWorker(defaultDeps(db), {
        concurrency: Number(process.env.FAV_WORKER_CONCURRENCY ?? 2)
      });
      console.log(JSON.stringify({ event: "embedded_worker_started", workerId: worker.workerId }));
    }

    if (process.env.FAV_SCHEDULERS !== "0" && process.env.FAV_AUTOPILOT_SCHEDULER !== "0") {
      setInterval(() => {
        void sweepDueAutopilotRules(defaultDeps(db)).catch((err: unknown) =>
          console.error(JSON.stringify({ event: "autopilot_sweep_failed", error: String(err) }))
        );
      }, 60_000);
      // Hourly: retention is measured in days, so this is about not drifting.
      setInterval(() => {
        void runMaintenance(db, getStorageProvider()).catch((err: unknown) =>
          console.error(JSON.stringify({ event: "maintenance_failed", error: String(err) }))
        );
      }, 3600_000);
    }
  }

  return {
    // Native/wasm deps resolvable from this app are externalized here.
    serverExternalPackages: ["@electric-sql/pglite", "pg"],
    webpack: (webpackConfig, { isServer }) => {
      if (isServer) {
        // Workspace packages must stay unbundled on the server: the workflow
        // loads the Remotion renderer (native bindings, import.meta.url file
        // resolution) and @fav/db locates migrations on disk. Next's
        // serverExternalPackages can't externalize symlinked workspace
        // packages, so mark them external for webpack directly — Node 22
        // require(esm) loads their ESM dists natively.
        webpackConfig.externals.push(
          "@fav/db",
          "@fav/providers",
          "@fav/workflows",
          "@fav/render"
        );
      }
      return webpackConfig;
    }
  };
}
