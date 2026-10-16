import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": projectRoot } },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"] }
});
