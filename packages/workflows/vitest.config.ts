import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 60000,
    // Each file spins up its own embedded PGlite (WASM Postgres) plus a
    // filesystem storage root. Running them in parallel was intermittently
    // exhausting resources and failing a healthy test, so these run serially —
    // a deterministic suite is worth more here than a faster one.
    fileParallelism: false
  }
});
