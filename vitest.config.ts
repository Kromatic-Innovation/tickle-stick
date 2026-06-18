import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      // Floors set a few points below current coverage (84/76/81/85) to
      // prevent regression without flaking on small fluctuations.
      thresholds: {
        statements: 80,
        branches: 72,
        functions: 78,
        lines: 80,
      },
    },
  },
});
