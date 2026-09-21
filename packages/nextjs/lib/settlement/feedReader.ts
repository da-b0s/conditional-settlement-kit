/**
 * Reading what the Chainlink feeds are actually doing, right now.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 *
 * feeds.ts records a measurement taken on 21 September 2026. A measurement in
 * a comment is a claim, and a claim in a template is something a reader has to
 * take on trust. This module re-takes the measurement live, so the argument
 * for per-feed bounds is checkable rather than asserted — and so a reader can
 * discover that the numbers have moved, which would be worth knowing.
 *
 * It needs no wallet, no operator, no key and no `.env`: a JSON-RPC
 * `eth_call` against a public endpoint is a plain HTTP POST. That is what
 * lets the route that renders this be the first thing a visitor sees.
 * ---------------------------------------------------------------------------
 *
 * NO VIEM, NO ETHERS, NO SDK
 *
 * Two calls with fixed selectors and fixed-width returns do not justify a
 * library. Hand-encoding keeps this file dependency-free — it runs in a route
 * handler, a script, a test or another framework — and the ABI encoding
 * involved is four lines. The decoding is explicit about the one thing worth
 * being explicit about: `answer` is a SIGNED int256, and reading it as
 * unsigned turns a negative price into a number near 2^256, which is exactly
 * the sort of value that sails through a naive bounds check.
 *
 * Framework-free. See invariants.ts.
 */
import { TESTNET_FEEDS, type PriceFeed } from "./feeds";

/** `latestRoundData()` */
const LATEST_ROUND_DATA = "0xfeaf968c";
/** `decimals()` */
const DECIMALS = "0x313ce567";

export const DEFAULT_RPC: Record<"testnet" | "mainnet", string> = {
  testnet: "https://testnet.hashio.io/api",
  mainnet: "https://mainnet.hashio.io/api",
};

/** One feed, as the chain reports it. */
export interface LiveFeed {
  pair: string;
  proxy: string;
  /** Raw answer at the feed's own precision. Signed. */
  answer: bigint;
  decimals: number;
  /** The feed's own updatedAt, in unix seconds. */
  updatedAt: number;
  /** Seconds between updatedAt and when this was read. */
  ageSeconds: number;
  roundId: bigint;
  answeredInRound: bigint;
  /** The bound this template would enforce for this feed. */
  boundSeconds: number;
  /** Whether the reading would pass that bound. */
  withinBound: boolean;
  /** Whether it would pass a single 1-hour bound applied to everything. */
  withinGlobalTightBound: boolean;
  /** True when the round's answer was carried over from an earlier round. */
  carriedOver: boolean;
}

export interface FeedReadFailure {
  pair: string;
  proxy: string;
  reason: string;
}

export interface LiveFeedReport {
  readAt: number;
  rpcUrl: string;
  feeds: LiveFeed[];
  failures: FeedReadFailure[];
  /** Highest observed age divided by lowest. The headline number. */
  spread: number | null;
  /** Feeds a single 1-hour bound would reject although each is healthy. */
  wronglyRejectedByTightGlobalBound: string[];
}

const hexToBigInt = (hex: string) => BigInt(hex.length === 0 ? "0x0" : hex.startsWith("0x") ? hex : `0x${hex}`);

/** Read a 32-byte word as a SIGNED integer. */
function wordToSigned(word: string): bigint {
  const value = hexToBigInt(word);
  const limit = 1n << 255n;
  // Two's complement: anything at or above 2^255 is negative.
  return value >= limit ? value - (1n << 256n) : value;
}

function wordAt(data: string, index: number): string {
  const body = data.startsWith("0x") ? data.slice(2) : data;
  return body.slice(index * 64, (index + 1) * 64);
}

async function ethCall(rpcUrl: string, to: string, data: string, doFetch: typeof fetch, id: number): Promise<string> {
  const response = await doFetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "eth_call", params: [{ to, data }, "latest"] }),
  });

  if (!response.ok) throw new Error(`RPC returned ${response.status}`);
  const payload = (await response.json()) as { result?: string; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "RPC error");
  if (!payload.result || payload.result === "0x") {
    // An empty return from a live endpoint means no contract at that address.
    throw new Error("empty response — no contract at this address on this network");
  }
  return payload.result;
}

/**
 * Read every feed in the table.
 *
 * One feed failing must not take the report down: a rate-limited or removed
 * proxy is reported in `failures` and the rest still render. A page that
 * shows nothing because one of seven feeds timed out is a page that will be
 * blank on a judge's machine.
 */
export async function readLiveFeeds(
  opts: { rpcUrl?: string; feeds?: readonly PriceFeed[]; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<LiveFeedReport> {
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC.testnet;
  const table = opts.feeds ?? TESTNET_FEEDS;
  const doFetch = opts.fetchImpl ?? fetch;
  const readAt = opts.now ?? Math.floor(Date.now() / 1000);

  const feeds: LiveFeed[] = [];
  const failures: FeedReadFailure[] = [];

  // In parallel: seven sequential round trips to Hashio is several seconds of
  // a page render, and they do not depend on each other.
  const results = await Promise.allSettled(
    table.map(async (feed, index) => {
      const [roundData, decimalsWord] = await Promise.all([
        ethCall(rpcUrl, feed.proxy, LATEST_ROUND_DATA, doFetch, index * 2),
        ethCall(rpcUrl, feed.proxy, DECIMALS, doFetch, index * 2 + 1),
      ]);

      const roundId = hexToBigInt(wordAt(roundData, 0));
      const answer = wordToSigned(wordAt(roundData, 1));
      const updatedAt = Number(hexToBigInt(wordAt(roundData, 3)));
      const answeredInRound = hexToBigInt(wordAt(roundData, 4));
      const decimals = Number(hexToBigInt(decimalsWord));
      const ageSeconds = readAt - updatedAt;

      const live: LiveFeed = {
        pair: feed.pair,
        proxy: feed.proxy,
        answer,
        decimals,
        updatedAt,
        ageSeconds,
        roundId,
        answeredInRound,
        boundSeconds: feed.recommendedMaxAgeSeconds,
        withinBound: ageSeconds <= feed.recommendedMaxAgeSeconds,
        withinGlobalTightBound: ageSeconds <= 3600,
        carriedOver: answeredInRound < roundId,
      };
      return live;
    }),
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") feeds.push(result.value);
    else {
      failures.push({
        pair: table[index].pair,
        proxy: table[index].proxy,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  const ages = feeds.map(f => f.ageSeconds).filter(a => a > 0);
  const spread = ages.length >= 2 ? Math.max(...ages) / Math.min(...ages) : null;

  return {
    readAt,
    rpcUrl,
    feeds,
    failures,
    spread,
    // The argument, recomputed from live data rather than from the table.
    wronglyRejectedByTightGlobalBound: feeds.filter(f => f.withinBound && !f.withinGlobalTightBound).map(f => f.pair),
  };
}

/** A price at feed precision, rendered for a human. Never for arithmetic. */
export function formatAnswer(answer: bigint, decimals: number): string {
  const negative = answer < 0n;
  const magnitude = negative ? -answer : answer;
  const unit = 10n ** BigInt(decimals);
  const whole = magnitude / unit;
  const fraction = (magnitude % unit).toString().padStart(decimals, "0").replace(/0+$/, "") || "0";
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** "13 minutes", "23.1 hours". Ages here span minutes to a day. */
export function formatAge(seconds: number): string {
  if (seconds < 0) return "in the future";
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  return `${(seconds / 3600).toFixed(1)} hours`;
}
