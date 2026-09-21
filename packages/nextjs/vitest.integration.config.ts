import { defineConfig } from "vitest/config";

/**
 * Live-endpoint tests. Separate config so the default `yarn test` can never
 * pick them up by accident — a unit suite that fails because testnet was slow
 * teaches developers to ignore red.
 */
export default defineConfig({
  test: {
    include: ["lib/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    // Sequential: the public mirror node and relay are rate limited, and
    // parallel requests from one IP are the fastest way to get throttled.
    fileParallelism: false,
  },
});
