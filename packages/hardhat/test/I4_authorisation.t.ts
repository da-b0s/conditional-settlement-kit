/**
 * I4 — Only authorised paths change final state. Emergency controls are
 * explicit and test-covered.
 *
 * Note what is NOT restricted, because it is deliberate:
 *
 *   trigger()  is permissionless. The decision rests on what the price source
 *              says, not on who asks. A beneficiary must never need the
 *              creator's cooperation to be paid.
 *   expire()   is permissionless. Expiry is a fact about the clock. HSS
 *              schedules it, but anyone may push it so nobody is stranded
 *              waiting on a scheduler that failed.
 *
 * What IS restricted is the ability to move value or change configuration:
 * only Settlement may mark triggered or settle, only the creator may take a
 * refund, only the owner may register feeds or re-point a source.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { DAI_USD, DAY, HBAR_USD, HOUR, State, advance, atFeedDecimals, createFundedPolicy, deploySystem, type Deployed } from "./helpers";

describe("I4 — only authorised paths change final state", () => {
  let d: Deployed;

  beforeEach(async () => {
    d = await deploySystem("0.0891");
  });

  describe("value-moving paths are restricted", () => {
    it("THE INVARIANT: a stranger cannot settle directly", async () => {
      const policyId = await createFundedPolicy(d);
      await expect(d.registry.connect(d.stranger).settle(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "NotSettlement",
      );
    });

    it("not even the owner can settle directly", async () => {
      // Ownership governs configuration, not money. Keeping those separate
      // means a compromised owner key cannot drain escrow by itself.
      const policyId = await createFundedPolicy(d);
      await expect(d.registry.connect(d.owner).settle(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "NotSettlement",
      );
    });

    it("a stranger cannot mark a policy triggered", async () => {
      const policyId = await createFundedPolicy(d);
      await expect(
        d.registry.connect(d.stranger).markTriggered(policyId, 1n, 1n),
      ).to.be.revertedWithCustomError(d.registry, "NotSettlement");
    });

    it("only the creator may take a refund", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: 60 });
      await advance(120);
      await d.registry.connect(d.stranger).expire(policyId);

      await expect(d.registry.connect(d.beneficiary).refund(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "NotCreator",
      );
      await expect(d.registry.connect(d.stranger).refund(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "NotCreator",
      );
      await expect(d.registry.connect(d.creator).refund(policyId)).to.not.be.reverted;
    });
  });

  describe("configuration is restricted to the owner", () => {
    it("a stranger cannot re-point the settlement contract", async () => {
      await expect(
        d.registry.connect(d.stranger).setSettlement(d.stranger.address),
      ).to.be.revertedWithCustomError(d.registry, "NotOwner");
    });

    it("a stranger cannot swap the price source", async () => {
      await expect(
        d.settlement.connect(d.stranger).setPriceSource(HBAR_USD, await d.source.getAddress()),
      ).to.be.revertedWithCustomError(d.settlement, "NotOwner");
    });

    it("a stranger cannot remove a feed", async () => {
      await expect(d.source.connect(d.stranger).removeFeed(HBAR_USD)).to.be.revertedWithCustomError(
        d.source,
        "NotOwner",
      );
    });

    it("ownership transfer works and the old owner loses access", async () => {
      await d.registry.connect(d.owner).transferOwnership(d.creator.address);
      expect(await d.registry.owner()).to.equal(d.creator.address);
      await expect(
        d.registry.connect(d.owner).setSettlement(d.stranger.address),
      ).to.be.revertedWithCustomError(d.registry, "NotOwner");
    });

    it("ownership cannot be transferred to the zero address", async () => {
      await expect(d.registry.connect(d.owner).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        d.registry,
        "ZeroAddress",
      );
    });
  });

  describe("permissionless by design, and that is the point", () => {
    it("anyone may trigger a policy whose condition is met", async () => {
      const policyId = await createFundedPolicy(d);
      const before = await ethers.provider.getBalance(d.beneficiary.address);

      // A complete stranger pushes it, and the beneficiary is paid.
      await d.settlement.connect(d.stranger).trigger(policyId);

      expect((await ethers.provider.getBalance(d.beneficiary.address)) - before).to.equal(ethers.parseEther("1"));
    });

    it("anyone may expire a policy past its deadline", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: 60 });
      await advance(120);
      await expect(d.registry.connect(d.stranger).expire(policyId)).to.not.be.reverted;
      expect(await d.registry.stateOf(policyId)).to.equal(State.Expired);
    });

    it("but nobody may expire one early", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: DAY });
      await expect(d.registry.connect(d.stranger).expire(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "NotYetExpired",
      );
      await expect(d.registry.connect(d.owner).expire(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "NotYetExpired",
      );
    });
  });

  describe("unknown policies", () => {
    it("every entry point rejects an id that does not exist", async () => {
      const ghost = 9_999n;
      await expect(d.registry.getPolicy(ghost)).to.be.revertedWithCustomError(d.registry, "UnknownPolicy");
      await expect(d.registry.expire(ghost)).to.be.revertedWithCustomError(d.registry, "UnknownPolicy");
      await expect(d.registry.connect(d.creator).refund(ghost)).to.be.revertedWithCustomError(
        d.registry,
        "UnknownPolicy",
      );
      await expect(d.registry.connect(d.creator).fund(ghost, { value: 1n })).to.be.revertedWithCustomError(
        d.registry,
        "UnknownPolicy",
      );
    });
  });
});
