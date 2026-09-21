/**
 * I2 — A trigger must use an allowed provider and feed, satisfy that feed's
 * own freshness bound, and match the policy's units and decimals.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE ONE THE MEASUREMENT PAID FOR.
 *
 * All seven Chainlink feeds on Hedera testnet declare the same 86,400-second
 * heartbeat. Read live on 21 September 2026 their ages spanned more than a
 * hundredfold — LINK at 12 minutes, DAI at 23.1 hours — and every reading was
 * inside spec.
 *
 * A single global bound fails both ways against that. Tight, it rejects
 * healthy slow feeds. Loose, it accepts an HBAR price nearly a day old and
 * settles on it while everything looks fine.
 *
 * So the bound is per feed, and registering a feed without one is impossible.
 * These tests hold that line.
 * ---------------------------------------------------------------------------
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  DAI_USD,
  DAY,
  HBAR_USD,
  HOUR,
  advance,
  atFeedDecimals,
  at18,
  createFundedPolicy,
  deploySystem,
  type Deployed,
} from "./helpers";

describe("I2 — allowed feed, per-feed freshness, correct decimals", () => {
  let d: Deployed;

  beforeEach(async () => {
    d = await deploySystem("0.0891", HOUR);
  });

  describe("freshness is per feed, not global", () => {
    it("accepts a reading inside this feed's bound", async () => {
      const policyId = await createFundedPolicy(d);
      await d.aggregator.setAgeSeconds(HOUR - 60); // just inside
      await expect(d.settlement.trigger(policyId)).to.not.be.reverted;
    });

    it("THE INVARIANT: refuses a reading past this feed's bound", async () => {
      const policyId = await createFundedPolicy(d);
      await d.aggregator.setAgeSeconds(HOUR + 60); // just outside
      await expect(d.settlement.trigger(policyId)).to.be.revertedWithCustomError(d.source, "ObservationStale");
    });

    it("refuses a reading that is stale by this feed's bound but fine by the declared heartbeat", async () => {
      // 6 hours old: comfortably inside the 24h heartbeat every feed declares,
      // and six times past what HBAR/USD should ever be. A system using the
      // declared heartbeat as its bound would settle on this.
      const policyId = await createFundedPolicy(d);
      await d.aggregator.setAgeSeconds(6 * HOUR);
      expect(6 * HOUR).to.be.lessThan(DAY); // inside spec...
      await expect(d.settlement.trigger(policyId)).to.be.revertedWithCustomError(d.source, "ObservationStale");
    });

    it("different feeds carry different bounds", async () => {
      // A slow feed legitimately needs the full heartbeat. The same source
      // must hold both bounds at once, which a global setting cannot.
      const slow = await ethers.deployContract("MockAggregatorV3", [8, atFeedDecimals("0.9998"), 0]);
      await slow.waitForDeployment();
      await slow.setAgeSeconds(20 * HOUR);
      await d.source.registerFeed(DAI_USD, await slow.getAddress(), DAY);

      expect(await d.source.maxAgeOf(HBAR_USD)).to.equal(HOUR);
      expect(await d.source.maxAgeOf(DAI_USD)).to.equal(DAY);

      // 20 hours old is fine for DAI and would be absurd for HBAR.
      await expect(d.source.latest(DAI_USD)).to.not.be.reverted;
      await d.aggregator.setAgeSeconds(20 * HOUR);
      await expect(d.source.latest(HBAR_USD)).to.be.revertedWithCustomError(d.source, "ObservationStale");
    });

    it("a feed cannot be registered without a bound", async () => {
      const agg = await ethers.deployContract("MockAggregatorV3", [8, atFeedDecimals("1"), 0]);
      await agg.waitForDeployment();
      await expect(d.source.registerFeed(DAI_USD, await agg.getAddress(), 0)).to.be.revertedWithCustomError(
        d.source,
        "MaxAgeRequired",
      );
    });

    it("a bound cannot be set so large that it disables the check", async () => {
      const agg = await ethers.deployContract("MockAggregatorV3", [8, atFeedDecimals("1"), 0]);
      await agg.waitForDeployment();
      await expect(
        d.source.registerFeed(DAI_USD, await agg.getAddress(), 365 * DAY),
      ).to.be.revertedWithCustomError(d.source, "MaxAgeTooLarge");
    });

    it("staleness is measured against the chain clock as it advances", async () => {
      const policyId = await createFundedPolicy(d);
      await d.aggregator.setAgeSeconds(0);
      await advance(2 * HOUR);
      await expect(d.settlement.trigger(policyId)).to.be.revertedWithCustomError(d.source, "ObservationStale");
    });
  });

  describe("only allowed feeds and providers", () => {
    it("refuses an asset with no registered feed", async () => {
      await expect(d.source.latest(DAI_USD)).to.be.revertedWithCustomError(d.source, "FeedNotRegistered");
    });

    it("refuses to point settlement at a source that cannot price the asset", async () => {
      await expect(d.settlement.setPriceSource(DAI_USD, await d.source.getAddress())).to.be.revertedWithCustomError(
        d.settlement,
        "SourceDoesNotSupport",
      );
    });

    it("a removed feed stops answering immediately", async () => {
      await d.source.removeFeed(HBAR_USD);
      await expect(d.source.latest(HBAR_USD)).to.be.revertedWithCustomError(d.source, "FeedNotRegistered");
    });

    it("only the owner may register a feed", async () => {
      const agg = await ethers.deployContract("MockAggregatorV3", [8, atFeedDecimals("1"), 0]);
      await agg.waitForDeployment();
      await expect(
        d.source.connect(d.stranger).registerFeed(DAI_USD, await agg.getAddress(), HOUR),
      ).to.be.revertedWithCustomError(d.source, "NotOwner");
    });
  });

  describe("units and decimals", () => {
    it("normalises 8 decimals to 18 exactly", async () => {
      const obs = await d.source.latest(HBAR_USD);
      // 0.0891 at 8dp becomes 0.0891 at 18dp — the same number, not 10^10 out.
      expect(obs.value).to.equal(at18("0.0891"));
    });

    it("refuses a feed whose decimals changed after registration", async () => {
      // A silent rescale would move every price by orders of magnitude while
      // every number still looked plausible.
      await d.aggregator.setDecimals(6);
      await expect(d.source.latest(HBAR_USD)).to.be.revertedWithCustomError(d.source, "DecimalsChanged");
    });

    it("refuses to register a feed reporting more decimals than the target", async () => {
      const agg = await ethers.deployContract("MockAggregatorV3", [20, 1, 0]);
      await agg.waitForDeployment();
      await expect(
        d.source.registerFeed(DAI_USD, await agg.getAddress(), HOUR),
      ).to.be.revertedWithCustomError(d.source, "DecimalsTooLarge");
    });
  });

  describe("readings that are not readings", () => {
    it("refuses a negative answer", async () => {
      await d.aggregator.setAnswer(-1);
      await expect(d.source.latest(HBAR_USD)).to.be.revertedWithCustomError(d.source, "NegativePrice");
    });

    it("refuses a zero answer", async () => {
      await d.aggregator.setAnswer(0);
      await expect(d.source.latest(HBAR_USD)).to.be.revertedWithCustomError(d.source, "NegativePrice");
    });

    it("refuses an answer carried over from an older round", async () => {
      // updatedAt can look fresh while the answer is old. roundId advancing
      // past answeredInRound is how that shows.
      await d.aggregator.setAgeSeconds(0);
      await d.aggregator.setRounds(9, 4);
      await expect(d.source.latest(HBAR_USD)).to.be.revertedWithCustomError(d.source, "IncompleteRound");
    });
  });
});
