import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "server/**/*.test.ts"],
    pool: "forks",
    /** server/handlers.test.ts draait op een echte SQLite-file; Prisma-startup kost even. */
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
