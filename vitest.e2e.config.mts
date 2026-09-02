import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * End-to-end suites. Separate from the unit config because these talk to the
 * real Supabase project named in .env.local: they are slow, they need
 * credentials, and they must never run as part of the fast feedback loop.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/e2e/**/*.e2e.ts"],
    // Real network round-trips against a hosted database.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // These suites create and destroy whole clubs; running two at once would
    // leave them fighting over the same throwaway rows.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "server-only": resolve(import.meta.dirname, "./scripts/e2e/server-only.stub.ts"),
    },
  },
});
