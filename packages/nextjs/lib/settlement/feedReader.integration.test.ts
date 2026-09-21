/**
 * The measurement, re-taken against the live network.
 *
 * feeds.ts records what the seven Chainlink feeds were doing on 21 September
 * 2026, and the whole per-feed-bound argument rests on it. A number in a
 * comment is a claim. This file re-reads the feeds from Hedera testnet and
 * checks the claim still holds, so a reviewer can run one command and see for
 * themselves rather than taking the README's word for it.
 *
 * Excluded from `yarn test` on purpose — it needs the network. Run it with:
 *
 *     yarn test:live
 *
 * The assertions are deliberately loose where the data is genuinely variable.
 * Asserting that DAI is 23.1 hours old would fail every day for the right
 * reason and the wrong purpose. What is asserted is the SHAPE of the finding:
 * the feeds exist, they all report 8 decimals, and the spread between the
 * freshest and the stalest is wide enough that no single bound serves them
 * all. That is the claim the design rests on, and it is the one worth
 * defending against drift.
 */
import { DEFAULT_RPC, formatAge, formatAnswer, readLiveFeeds } from "./feedReader";
import { DECLARED_HEARTBEAT_SECONDS, FEED_DECIMALS, TESTNET_FEEDS } from "./feeds";
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
          `${feed.withinGlobalTightBound ? "" : "   <- a 1h global bound would reject this healthy feed"}`,
      );
    }
    for (const failure of report.failures) {
      console.log(`  ${failure.pair.padEnd(9)} COULD NOT READ: ${failure.reason}`);
    }
    console.log(`\n  spread: ${report.spread?.toFixed(1)}x\n`);

    // At least most of the table must have answered. Hashio rate limits, and
    // demanding all seven would make this flaky for a reason unrelated to the
    // claim — but if four of seven are unreachable, something is actually wrong.
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

  it("THE ARGUMENT: the spread is still too wide for one global bound", async () => {
    // The recorded sample was 116x. Asserting 116 would be asserting noise;
    // asserting an order of magnitude asserts the finding.
    const report = await readLiveFeeds();
    expect(report.spread).not.toBeNull();
    expect(report.spread!).toBeGreaterThan(10);
  });

  it("THE ARGUMENT: a 1-hour global bound still rejects healthy feeds", async () => {
    const report = await readLiveFeeds();
    // Each of these passes its own bound and fails a tight global one. That
    // is the whole case for storing maxAge per feed.
    expect(report.wronglyRejectedByTightGlobalBound.length).toBeGreaterThan(0);
  });

  it("every feed is inside its declared heartbeat, which is why the heartbeat is no help", async () => {
    // The point is not that a feed misbehaves. Every one is in spec, and the
    // spread happens anyway.
    const report = await readLiveFeeds();
    for (const feed of report.feeds) {
      expect(feed.ageSeconds, `${feed.pair} exceeds its own declared heartbeat`).toBeLessThanOrEqual(
        DECLARED_HEARTBEAT_SECONDS,
      );
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
