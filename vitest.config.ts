import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "packages/hmem/test/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
