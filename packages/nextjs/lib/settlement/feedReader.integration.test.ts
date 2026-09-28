/** Live observations, separate from offline correctness tests.
 * Run yarn next:test:live. Availability, decimals, positive prices and round
 * validity are checked below. Age spread is reported as an observation,
 * not a permanent truth or evidence of payout safety.
 */
import { DEFAULT_RPC, formatAge, formatAnswer, readLiveFeeds } from "./feedReader";
import { FEED_DECIMALS, TESTNET_FEEDS } from "./feeds";
import { describe, expect, it } from "vitest";

describe("the seven feeds, live on Hedera testnet", () => {
  it("re-takes the measurement and prints it", async () => {
    const report = await readLiveFeeds({ rpcUrl: DEFAULT_RPC.testnet });

    // Printed because the numbers are the point. A reviewer reading CI output
    // should see the evidence, not just a green tick.
    console.log(`\n  read via ${report.rpcUrl} at ${new Date(report.readAt * 1000).toISOString()}\n`);
    for (const feed of report.feeds) {
      console.log(
        `  ${feed.pair.padEnd(9)} ${formatAnswer(feed.answer, feed.decimals).padStart(14)}  ` +
          `${String(feed.decimals).padStart(2)}dp  age ${formatAge(feed.ageSeconds).padStart(12)}  ` +
          `bound ${String(feed.boundSeconds / 3600).padStart(2)}h  ${feed.withinBound ? "ok   " : "STALE"}` +
          `${feed.withinGlobalTightBound ? "" : "   <- age exceeds a 1h limit"}`,
      );
    }
    for (const failure of report.failures) {
      console.log(`  ${failure.pair.padEnd(9)} COULD NOT READ: ${failure.reason}`);
    }
    console.log(`\n  spread: ${report.spread?.toFixed(1)}x\n`);

    // At least most of the table must have answered. Hashio rate limits, and
    // demanding all seven would make this flaky for a reason unrelated to the
    // availability check — but if four of seven are unreachable, something is actually wrong.
    expect(report.feeds.length).toBeGreaterThanOrEqual(5);
  });

  it("every feed still reports 8 decimals", async () => {
    // If one ever changes, ChainlinkPriceSource.latest() reverts with
    // DecimalsChanged rather than silently rescaling — but we would want to
    // know here first.
    const report = await readLiveFeeds();
    for (const feed of report.feeds) {
      expect(feed.decimals, `${feed.pair} decimals`).toBe(FEED_DECIMALS);
    }
  });

  it("no feed returns a negative or zero price", async () => {
    const report = await readLiveFeeds();
    for (const feed of report.feeds) {
      expect(feed.answer, `${feed.pair} answer`).toBeGreaterThan(0n);
    }
  });

  it("no feed is serving an answer carried over from an older round", async () => {
    const report = await readLiveFeeds();
    for (const feed of report.feeds) {
      expect(feed.carriedOver, `${feed.pair} answeredInRound < roundId`).toBe(false);
    }
  });

  it("the table has no address that has stopped answering", async () => {
    // A proxy that was redeployed would show up here as a failure to read,
    // and would otherwise be invisible until a settlement needed it.
    const report = await readLiveFeeds();
    const unreachable = report.failures.filter(f => f.reason.includes("no contract"));
    expect(unreachable, `dead proxies: ${unreachable.map(f => f.pair).join(", ")}`).toHaveLength(0);
  });

  it("covers the whole table", async () => {
    const report = await readLiveFeeds();
    expect(report.feeds.length + report.failures.length).toBe(TESTNET_FEEDS.length);
  });
});
