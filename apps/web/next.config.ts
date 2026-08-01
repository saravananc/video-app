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
    // Native/wasm server deps must never be bundled — they're direct deps of
    // this app so Node resolves them at runtime.
    serverExternalPackages: ["@electric-sql/pglite", "pg"]
  };
}
