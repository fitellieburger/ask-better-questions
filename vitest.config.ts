import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["**/node_modules/**", "mobile/**"],
    coverage: {
      provider: "v8",
      include: ["app/api/**/*.ts", "lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/node_modules/**"],
      reporter: ["text", "html", "lcov"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
    },
  },
});
