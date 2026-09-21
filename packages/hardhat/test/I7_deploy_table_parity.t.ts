/**
 * The deploy script and the UI must describe the same bounds.
 *
 * `deploy/00_deploy_settlement.ts` carries its own copy of the feed table,
 * because Hardhat scripts and the Next app do not share a module graph. A copy
 * is a thing that drifts. If it drifts here, the consequence is specific and
 * bad: the interface tells a user a price is bounded to one hour while the
 * chain is enforcing twenty-four, and nobody finds out until a stale reading
 * settles a payout.
 *
 * So the copy is allowed, and this file is the price of it.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { FEEDS, assetKey } from "../deploy/00_deploy_settlement";
import { TESTNET_FEEDS } from "../../nextjs/lib/settlement/feeds";

/** ChainlinkPriceSource.MAX_CONFIGURABLE_AGE, asserted against the contract below. */
const MAX_CONFIGURABLE_AGE = 172_800;

describe("deploy table parity with lib/settlement/feeds.ts", () => {
  it("covers exactly the same pairs", () => {
    expect(FEEDS.map(f => f.pair).sort()).to.deep.equal(TESTNET_FEEDS.map(f => f.pair).sort());
  });

  it("uses the same proxy address for each pair", () => {
    for (const feed of FEEDS) {
      const ui = TESTNET_FEEDS.find(f => f.pair === feed.pair);
      expect(ui, `${feed.pair} missing from the UI table`).to.not.equal(undefined);
      expect(feed.proxy.toLowerCase()).to.equal(ui!.proxy.toLowerCase());
    }
  });

  it("deploys the bound the UI advertises", () => {
    // The assertion that actually matters.
    for (const feed of FEEDS) {
      const ui = TESTNET_FEEDS.find(f => f.pair === feed.pair)!;
      expect(feed.maxAge, `${feed.pair} bound`).to.equal(ui.recommendedMaxAgeSeconds);
    }
  });

  it("derives asset keys the way the contracts expect", () => {
    expect(assetKey("HBAR/USD")).to.equal(ethers.keccak256(ethers.toUtf8Bytes("HBAR/USD")));
  });

  it("registers no feed without a bound, and none above the contract limit", () => {
    for (const feed of FEEDS) {
      expect(feed.maxAge).to.be.greaterThan(0);
      expect(feed.maxAge).to.be.lessThanOrEqual(MAX_CONFIGURABLE_AGE);
    }
  });

  it("the contract limit is what this file assumes it is", async () => {
    // Otherwise the check above could pass against a stale constant.
    const source = await (await ethers.getContractFactory("ChainlinkPriceSource")).deploy();
    expect(await source.MAX_CONFIGURABLE_AGE()).to.equal(MAX_CONFIGURABLE_AGE);
  });
});
