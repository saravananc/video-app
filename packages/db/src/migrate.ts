import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { dbKind, getDb, type Db } from "./client.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Works from both src/ (tsx) and dist/ (built) since migrations sit at the package root. */
export function migrationsFolder(): string {
  return path.resolve(HERE, "..", "migrations");
}

export async function runMigrations(db: Db = getDb(), kind = dbKind()): Promise<void> {
  const folder = migrationsFolder();
  if (kind === "postgres") {
    await migratePg(db as Parameters<typeof migratePg>[0], { migrationsFolder: folder });
  } else {
    await migratePglite(db as Parameters<typeof migratePglite>[0], { migrationsFolder: folder });
  }
}

/** Test helper: migrate an arbitrary PGlite db (from createTestDb). */
export async function migrateTestDb(db: Db): Promise<void> {
  await migratePglite(db as Parameters<typeof migratePglite>[0], {
    migrationsFolder: migrationsFolder()
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runMigrations()
    .then(() => {
      console.log("migrations applied");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
