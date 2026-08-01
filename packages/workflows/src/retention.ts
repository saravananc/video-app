import { and, isNotNull, lt, sql } from "drizzle-orm";
import { videos, type Db } from "@fav/db";
import type { StorageProvider } from "@fav/providers";
import { cleanupIntermediateAssets, purgeVideoAssets } from "./maintenance.js";

/** Retention policy (FAV-1606). Override per deployment via env. */
export const RETENTION = {
  /** Days after completion before narration audio is expired (regenerable). */
  intermediateDays: Number(process.env.FAV_RETENTION_INTERMEDIATE_DAYS ?? 7),
  /**
   * Days a soft-deleted video's row is kept before its remaining traces are
   * scrubbed. The row itself is never dropped — credit_ledger references it and
   * that ledger is append-only (FAV-303).
   */
  softDeletedDays: Number(process.env.FAV_RETENTION_SOFT_DELETED_DAYS ?? 30)
};

/**
 * Sweep soft-deleted videos past the retention window, making sure no assets
 * survive even if the original delete request failed partway through.
 */
export async function enforceDeletionRetention(
  db: Db,
  storage: StorageProvider,
  olderThanDays = RETENTION.softDeletedDays
): Promise<{ scrubbed: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 3600 * 1000);
  const rows = await db
    .select({ id: videos.id })
    .from(videos)
    .where(
      and(
        isNotNull(videos.deletedAt),
        lt(videos.deletedAt, cutoff),
        // Only rows still carrying asset references need work.
        sql`(${videos.finalAssetKey} is not null or ${videos.narrationAssetKey} is not null or ${videos.script} is not null)`
      )
    );

  for (const row of rows) {
    await purgeVideoAssets(db, storage, row.id).catch(() => undefined);
    await db
      .update(videos)
      .set({
        finalAssetKey: null,
        narrationAssetKey: null,
        thumbnailAssetKey: null,
        script: null,
        captionCues: null,
        request: {},
        updatedAt: new Date()
      })
      .where(sql`${videos.id} = ${row.id}`);
  }
  return { scrubbed: rows.length };
}

export interface MaintenanceResult {
  intermediatesCleaned: number;
  deletedScrubbed: number;
  ranAt: string;
}

/**
 * The scheduled maintenance pass (FAV-1003/1606). Wired to an interval in dev
 * and to an external cron in production via POST /api/admin/maintenance.
 */
export async function runMaintenance(db: Db, storage: StorageProvider): Promise<MaintenanceResult> {
  const [{ cleaned }, { scrubbed }] = await Promise.all([
    cleanupIntermediateAssets(db, storage, RETENTION.intermediateDays),
    enforceDeletionRetention(db, storage, RETENTION.softDeletedDays)
  ]);
  const result = { intermediatesCleaned: cleaned, deletedScrubbed: scrubbed, ranAt: new Date().toISOString() };
  if (cleaned > 0 || scrubbed > 0) {
    console.log(JSON.stringify({ event: "maintenance_run", ...result }));
  }
  return result;
}
