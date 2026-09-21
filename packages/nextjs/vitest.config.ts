import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests are pure and hermetic. Tests that hit the live mirror node
    // are named *.integration.test.ts and excluded from the default run, so
    // `yarn test` stays fast, offline-safe, and never flaky because testnet
    // was slow. Run them explicitly with `yarn test --mode integration`.
    include: ["lib/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    environment: "node",
  },
});
