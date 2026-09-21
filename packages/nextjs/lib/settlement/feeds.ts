/**
 * Chainlink price feeds on Hedera testnet, and why each one needs its own
 * staleness bound.
 *
 * ---------------------------------------------------------------------------
 * THE MEASUREMENT THAT DECIDES THE DESIGN
 *
 * All seven feeds declare an 86,400-second (24-hour) heartbeat. Every reading
 * below is therefore "within spec". Read live via latestRoundData() on
 * 21 September 2026:
 *
 *   HBAR/USD    13 minutes
 *   LINK/USD    12 minutes
 *   BTC/USD     18 minutes
 *   ETH/USD     36 minutes
 *   USDC/USD    16.1 hours
 *   USDT/USD    16.0 hours
 *   DAI/USD     23.1 hours      <- 54 minutes from its declared limit
 *
 * Over a HUNDRED-FOLD spread, and not one value out of spec. The exact
 * figure is computed by observedFreshnessSpread() from the constants below
 * rather than written into this comment, so the prose cannot drift away from
 * the data — it is 116x for the sample recorded here.
 *
 * A single global maxAge cannot work against that, and the failure runs both
 * ways:
 *
 *   A 1-hour global bound rejects USDC, USDT and DAI — all three healthy by
 *   their own standard, all three refused.
 *
 *   A 24-hour global bound accepts everything today, which sounds fine until
 *   you notice it would also accept an HBAR/USD price twenty-three hours old.
 *   At this feed's observed cadence that is roughly a hundred updates behind,
 *   and it would settle a payout on it without complaint.
 *
 * The second failure is the dangerous one precisely because nothing looks
 * wrong: every feed is inside its declared heartbeat, the call succeeds, and
 * the money moves on a price from yesterday.
 *
 * So the bound belongs to the feed, not to the system. That is invariant I2,
 * and it is the reason this template is not just a wrapper over the official
 * oracles template.
 *
 * ---------------------------------------------------------------------------
 * HONESTY ABOUT THESE NUMBERS
 *
 * The ages above are ONE sample each. One sample is not a distribution, and
 * `recommendedMaxAge` below is a defensible starting point rather than a
 * derived truth. It is deliberately generous: roughly four times the observed
 * age for the fast feeds, and the declared heartbeat for the slow ones, so a
 * normal update gap never trips it.
 *
 * Tune it with your own observations before trusting it with money. The
 * product claim is that the bound must be PER FEED and configurable — not
 * that these particular constants are correct for your use.
 *
 * How much these move is not hypothetical. Re-read a few hours later the same
 * day, the spread was 228x rather than 116x, DAI had gone from 23.1 hours to
 * 27 minutes, and the feed a 1-hour global bound would have wrongly rejected
 * was BTC/USD at 1.6 hours — a feed that was 18 minutes old in the sample
 * above. Every specific number here moved. The structural finding did not:
 * some feeds are minutes old, others are hours old, all of them are in spec,
 * and no single bound fits them. That is what the design rests on.
 *
 * feedReader.integration.test.ts re-takes this measurement live and asserts
 * the structure rather than the constants. Run `yarn test:live` to see it.
 * ---------------------------------------------------------------------------
 *
 * Framework-free. See invariants.ts.
 */

export interface PriceFeed {
  /** e.g. "HBAR/USD" */
  pair: string;
  /** The AggregatorV3Interface proxy on Hedera testnet. */
  proxy: `0x${string}`;
  /** Every Chainlink feed here reports 8. Never assume it — read it. */
  decimals: number;
  /** What the feed itself promises, in seconds. Identical across all seven. */
  declaredHeartbeatSeconds: number;
  /** Age observed on 21 September 2026, in seconds. One sample. */
  observedAgeSeconds: number;
  /** A starting bound, in seconds. See the honesty note above. */
  recommendedMaxAgeSeconds: number;
}

/** All Chainlink feeds carry 8 decimals; EVM amounts are composed at 18. */
export const FEED_DECIMALS = 8;
export const TARGET_DECIMALS = 18;

/** Declared by every feed on this network. Not a useful bound on its own. */
export const DECLARED_HEARTBEAT_SECONDS = 86_400;

const HOUR = 3_600;

export const TESTNET_FEEDS: readonly PriceFeed[] = [
  {
    pair: "HBAR/USD",
    proxy: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
    decimals: 8,
    declaredHeartbeatSeconds: DECLARED_HEARTBEAT_SECONDS,
    observedAgeSeconds: 13 * 60,
    // The canonical demo feed: it updates most often, so a demo actually moves.
    recommendedMaxAgeSeconds: 1 * HOUR,
  },
  {
    pair: "LINK/USD",
    proxy: "0xF111b70231E89D69eBC9f6C9208e9890383Ef432",
    decimals: 8,
    declaredHeartbeatSeconds: DECLARED_HEARTBEAT_SECONDS,
    observedAgeSeconds: 12 * 60,
    recommendedMaxAgeSeconds: 1 * HOUR,
  },
  {
    pair: "BTC/USD",
    proxy: "0x058fE79CB5775d4b167920Ca6036B824805A9ABd",
    decimals: 8,
    declaredHeartbeatSeconds: DECLARED_HEARTBEAT_SECONDS,
    observedAgeSeconds: 18 * 60,
    recommendedMaxAgeSeconds: 2 * HOUR,
  },
  {
    pair: "ETH/USD",
    proxy: "0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9",
    decimals: 8,
    declaredHeartbeatSeconds: DECLARED_HEARTBEAT_SECONDS,
    observedAgeSeconds: 36 * 60,
    recommendedMaxAgeSeconds: 3 * HOUR,
  },
  {
    pair: "USDC/USD",
    proxy: "0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5",
    decimals: 8,
    declaredHeartbeatSeconds: DECLARED_HEARTBEAT_SECONDS,
    observedAgeSeconds: Math.round(16.1 * HOUR),
    // Slow by nature. Anything tighter than the heartbeat rejects a healthy feed.
    recommendedMaxAgeSeconds: DECLARED_HEARTBEAT_SECONDS,
  },
  {
    pair: "USDT/USD",
    proxy: "0x06823de8E77d708C4cB72Cbf04495D67afF4Bd37",
    decimals: 8,
    declaredHeartbeatSeconds: DECLARED_HEARTBEAT_SECONDS,
    observedAgeSeconds: Math.round(16.0 * HOUR),
    recommendedMaxAgeSeconds: DECLARED_HEARTBEAT_SECONDS,
  },
  {
    pair: "DAI/USD",
    proxy: "0xdA2aBF7C90aDC73CDF5cA8d720B87bD5F5863389",
    decimals: 8,
    declaredHeartbeatSeconds: DECLARED_HEARTBEAT_SECONDS,
    observedAgeSeconds: Math.round(23.1 * HOUR),
    recommendedMaxAgeSeconds: DECLARED_HEARTBEAT_SECONDS,
  },
] as const;

/** The demo feed. Freshest of the seven, so the demonstration visibly moves. */
export const CANONICAL_FEED = "HBAR/USD";

/**
 * There are NO Chainlink Proof-of-Reserve feeds on Hedera, testnet or
 * mainnet, despite announcements suggesting otherwise. Verified by reading
 * the network, not the press release. Do not design around them.
 */
export const PROOF_OF_RESERVE_AVAILABLE = false;

export function feedByPair(pair: string): PriceFeed | undefined {
  return TESTNET_FEEDS.find(f => f.pair === pair);
}

/**
 * The ratio between the stalest and freshest observed feed.
 *
 * Computed rather than written down, so the argument in the README cannot
 * drift away from the data it rests on.
 */
export function observedFreshnessSpread(feeds: readonly PriceFeed[] = TESTNET_FEEDS): number {
  const ages = feeds.map(f => f.observedAgeSeconds).filter(a => a > 0);
  if (ages.length < 2) return 1;
  return Math.round(Math.max(...ages) / Math.min(...ages));
}

/**
 * Would a single global bound work? No — and this says so with a number.
 *
 * Returns the feeds a global bound would wrongly reject (healthy but slow)
 * and those it would wrongly accept (stale by their own standard).
 */
export function globalBoundDamage(
  globalMaxAgeSeconds: number,
  feeds: readonly PriceFeed[] = TESTNET_FEEDS,
): { wronglyRejected: string[]; wronglyAccepted: string[] } {
  const wronglyRejected: string[] = [];
  const wronglyAccepted: string[] = [];
  for (const f of feeds) {
    const tooOldForGlobal = f.observedAgeSeconds > globalMaxAgeSeconds;
    const staleForItself = f.observedAgeSeconds > f.recommendedMaxAgeSeconds;
    // Healthy by its own bound, refused by the global one.
    if (tooOldForGlobal && !staleForItself) wronglyRejected.push(f.pair);
    // Stale by its own bound, waved through by the global one.
    if (!tooOldForGlobal && staleForItself) wronglyAccepted.push(f.pair);
  }
  return { wronglyRejected, wronglyAccepted };
}

/**
 * Chainlink answers are 8dp; EVM amounts are composed at 18dp. Widening is
 * exact, so this never loses precision — but doing it implicitly is how a
 * price ends up 10^10 out, which is the same class of bug as tinybar/weibar.
 */
export function normaliseTo18(answer: bigint, feedDecimals: number = FEED_DECIMALS): bigint {
  if (feedDecimals > TARGET_DECIMALS) {
    throw new Error(
      `Feed reports ${feedDecimals} decimals, more than the ${TARGET_DECIMALS} target; narrowing is lossy.`,
    );
  }
  return answer * 10n ** BigInt(TARGET_DECIMALS - feedDecimals);
}
