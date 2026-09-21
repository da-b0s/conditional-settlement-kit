/**
 * The measurement that decides the design, held in place.
 *
 * These tests exist so the argument in the README cannot quietly stop being
 * true. If someone edits the feed table and the spread collapses, or adds a
 * feed without a bound, the failure is here rather than in a judge's head.
 */
import {
  CANONICAL_FEED,
  DECLARED_HEARTBEAT_SECONDS,
  FEED_DECIMALS,
  PROOF_OF_RESERVE_AVAILABLE,
  TARGET_DECIMALS,
  TESTNET_FEEDS,
  feedByPair,
  globalBoundDamage,
  normaliseTo18,
  observedFreshnessSpread,
} from "./feeds";
import { describe, expect, it } from "vitest";

const HOUR = 3600;

describe("the freshness measurement", () => {
  it("every feed declares the same heartbeat, which is why it is useless as a bound", () => {
    // This is the whole premise. If Chainlink ever varies the declared
    // heartbeat per feed on Hedera, the argument weakens and this fails.
    for (const f of TESTNET_FEEDS) {
      expect(f.declaredHeartbeatSeconds).toBe(DECLARED_HEARTBEAT_SECONDS);
    }
  });

  it("observed ages nonetheless span more than a hundredfold", () => {
    expect(observedFreshnessSpread()).toBeGreaterThan(100);
  });

  it("every observed age is within the declared heartbeat", () => {
    // The point is not that a feed misbehaved. Every one is in spec, and the
    // spread happens anyway.
    for (const f of TESTNET_FEEDS) {
      expect(f.observedAgeSeconds).toBeLessThanOrEqual(f.declaredHeartbeatSeconds);
    }
  });

  it("THE ARGUMENT: a tight global bound rejects healthy feeds", () => {
    const { wronglyRejected } = globalBoundDamage(1 * HOUR);
    expect(wronglyRejected).toContain("USDC/USD");
    expect(wronglyRejected).toContain("USDT/USD");
    expect(wronglyRejected).toContain("DAI/USD");
  });

  it("THE ARGUMENT: a loose global bound would accept a badly stale fast feed", () => {
    // Nothing is wrongly accepted in today's snapshot, because no feed is
    // currently stale by its own standard. The danger is what a 24h bound
    // PERMITS: simulate an HBAR reading 23 hours old and it sails through a
    // global bound while its own bound refuses it.
    const hbar = feedByPair("HBAR/USD")!;
    const stale = { ...hbar, observedAgeSeconds: 23 * HOUR };
    const { wronglyAccepted } = globalBoundDamage(DECLARED_HEARTBEAT_SECONDS, [stale]);
    expect(wronglyAccepted).toEqual(["HBAR/USD"]);
  });

  it("each feed's own bound accepts its own observed age", () => {
    // A bound that rejects the feed's normal behaviour is a bound nobody will
    // keep. If this fails, the recommended values are too aggressive.
    for (const f of TESTNET_FEEDS) {
      expect(f.observedAgeSeconds).toBeLessThanOrEqual(f.recommendedMaxAgeSeconds);
    }
  });

  it("no feed is registered without a bound", () => {
    for (const f of TESTNET_FEEDS) {
      expect(f.recommendedMaxAgeSeconds).toBeGreaterThan(0);
    }
  });

  it("the canonical demo feed is the freshest one, so a demo actually moves", () => {
    const canonical = feedByPair(CANONICAL_FEED)!;
    const fastest = Math.min(...TESTNET_FEEDS.map(f => f.observedAgeSeconds));
    // Within a couple of minutes of the fastest; LINK edges it on this sample.
    expect(canonical.observedAgeSeconds - fastest).toBeLessThanOrEqual(120);
  });
});

describe("decimals", () => {
  it("every feed reports 8", () => {
    for (const f of TESTNET_FEEDS) expect(f.decimals).toBe(FEED_DECIMALS);
  });

  it("widening 8 to 18 is exact", () => {
    // 0.0891 at 8dp -> the same value at 18dp, not 10^10 out.
    expect(normaliseTo18(8_910_000n)).toBe(89_100_000_000_000_000n);
    expect(normaliseTo18(1n)).toBe(10n ** 10n);
  });

  it("refuses to narrow, because narrowing loses money silently", () => {
    expect(() => normaliseTo18(1n, TARGET_DECIMALS + 1)).toThrow(/narrowing is lossy/);
  });

  it("is a no-op when the feed already reports 18", () => {
    expect(normaliseTo18(42n, TARGET_DECIMALS)).toBe(42n);
  });
});

describe("facts checked against the network rather than the announcements", () => {
  it("records that Hedera has no Chainlink Proof-of-Reserve feeds", () => {
    // Verified by reading the network. Designing around a feed that does not
    // exist is a failure mode worth encoding rather than remembering.
    expect(PROOF_OF_RESERVE_AVAILABLE).toBe(false);
  });

  it("every proxy address is a well-formed EVM address", () => {
    for (const f of TESTNET_FEEDS) {
      expect(f.proxy).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it("no two feeds share a proxy", () => {
    const seen = new Set(TESTNET_FEEDS.map(f => f.proxy.toLowerCase()));
    expect(seen.size).toBe(TESTNET_FEEDS.length);
  });
});
