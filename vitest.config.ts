import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ahq/api-contracts": src("../../packages/api-contracts/src/index.ts"),
      "@ahq/shared-types": src("../../packages/shared-types/src/index.ts"),
      "@ahq/game-content": src("../../packages/game-content/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
