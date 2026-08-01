import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    // Only used when running drizzle-kit against a live database; migrations are
    // normally applied programmatically via src/migrate.ts (works for PGlite too).
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/fav"
  }
});
