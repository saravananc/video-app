import path from "node:path";
import { mkdirSync } from "node:fs";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzlePg<typeof schema>> | ReturnType<typeof drizzlePglite<typeof schema>>;

let cached: { db: Db; kind: "postgres" | "pglite" } | null = null;

export function dataDir(): string {
  return process.env.FAV_DATA_DIR ?? path.join(process.cwd(), ".data");
}

/**
 * DATABASE_URL set -> managed Postgres (Neon in prod, FAV-104).
 * Unset -> embedded PGlite under .data/, so dev needs no database server while
 * keeping the exact Postgres dialect and identical migrations.
 */
export function getDb(): Db {
  if (cached) return cached.db;
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    const pool = new Pool({ connectionString: url, max: 10 });
    cached = { db: drizzlePg(pool, { schema }), kind: "postgres" };
  } else {
    const dir = path.join(dataDir(), "pglite");
    mkdirSync(dir, { recursive: true });
    const pglite = new PGlite(dir);
    cached = { db: drizzlePglite(pglite, { schema }), kind: "pglite" };
  }
  return cached.db;
}

export function dbKind(): "postgres" | "pglite" {
  if (!cached) getDb();
  return cached!.kind;
}

/** Test helper: fresh in-memory PGlite database, isolated per call. */
export function createTestDb(): Db {
  const pglite = new PGlite();
  return drizzlePglite(pglite, { schema });
}

export { schema };
