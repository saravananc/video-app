import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants";

/**
 * next.config runs in plain Node (never bundled), so it's the one place we can
 * run migrations + seed at server startup without webpack interfering with
 * PGlite/drizzle file resolution. Build phase skips it.
 */
export default async function config(phase: string): Promise<NextConfig> {
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER) {
    const { getDb, runMigrations, seed } = await import("@fav/db");
    const db = getDb();
    await runMigrations(db);
    if (process.env.FAV_AUTO_SEED !== "0") {
      await seed(db);
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
