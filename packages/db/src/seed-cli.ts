import { getDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seed } from "./seed.js";

const db = getDb();
await runMigrations(db);
const { orgId } = await seed(db);
console.log(`seeded org ${orgId}`);
process.exit(0);
