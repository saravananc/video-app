import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    // Same reasoning as @fav/workflows: embedded PGlite per file is heavy.
    fileParallelism: false
  }
});
