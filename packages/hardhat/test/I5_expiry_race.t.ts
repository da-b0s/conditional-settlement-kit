/**
 * I5 — Expiry and settlement cannot both succeed. Both orderings are covered.
 *
 * ---------------------------------------------------------------------------
 * This is the invariant a real deployment would break, because the race is
 * genuine: an HSS-scheduled expiry and a beneficiary's trigger can land in the
 * same second, and whichever the network orders first must win completely.
 *
 * The design makes the race harmless rather than unlikely. `settled` and
 * `refunded` are both terminal, neither appears on the left of any legal
 * transition, and everything routes through one guard. There is no window in
 * which both paths think they may proceed, because the second one to arrive
 * finds a state it cannot move out of.
 *
 * Both orderings are tested. Testing only one is how this invariant passes
 * review and fails in production.
 * ---------------------------------------------------------------------------
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { DAY, State, advance, createFundedPolicy, deploySystem, type Deployed } from "./helpers";

describe("I5 — expiry and settlement are mutually exclusive", () => {
  let d: Deployed;

  beforeEach(async () => {
    d = await deploySystem("0.0891");
  });

  describe("ordering A: settle first, then expiry arrives", () => {
    it("THE INVARIANT: expiry cannot touch a settled policy", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: 3600 });
      await d.settlement.trigger(policyId);
      expect(await d.registry.stateOf(policyId)).to.equal(State.Settled);

      // The scheduled expiry fires late, as it will.
      await advance(7200);
      await expect(d.registry.expire(policyId)).to.be.revertedWithCustomError(d.registry, "IllegalTransition");
      expect(await d.registry.stateOf(policyId)).to.equal(State.Settled);
    });

    it("and no refund can follow a settlement", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: 3600 });
      await d.settlement.trigger(policyId);
      await advance(7200);

      await expect(d.registry.connect(d.creator).refund(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "IllegalTransition",
      );
    });
  });

  describe("ordering B: expiry first, then a trigger arrives", () => {
    it("THE INVARIANT: settlement cannot touch an expired policy", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: 60 });
      await advance(120);
      await d.registry.expire(policyId);
      expect(await d.registry.stateOf(policyId)).to.equal(State.Expired);

      // The condition is still met — the price has not moved — but the
      // window has closed.
      await expect(d.settlement.trigger(policyId)).to.be.reverted;
      expect(await d.registry.stateOf(policyId)).to.equal(State.Expired);
    });

    it("a trigger is refused once the deadline passes, even before expire() is called", async () => {
      // The gap between the deadline and somebody calling expire() must not
      // be a window in which a late settlement still works.
      const policyId = await createFundedPolicy(d, { expiryInSeconds: 60 });
      await advance(120);
      expect(await d.registry.stateOf(policyId)).to.equal(State.Active);

      await expect(d.settlement.trigger(policyId)).to.be.revertedWithCustomError(d.registry, "AlreadyExpired");
    });

    it("the refund returns the full escrow and nothing more", async () => {
      const policyId = await createFundedPolicy(d, {
        escrow: ethers.parseEther("2"),
        payout: ethers.parseEther("2"),
        expiryInSeconds: 60,
      });
      await advance(120);
      await d.registry.expire(policyId);

      const before = await ethers.provider.getBalance(d.creator.address);
      const tx = await d.registry.connect(d.creator).refund(policyId);
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;

      expect((await ethers.provider.getBalance(d.creator.address)) + gas - before).to.equal(ethers.parseEther("2"));
      expect(await d.registry.totalEscrowed()).to.equal(0n);
    });
  });

  describe("both terminal states are genuinely terminal", () => {
    it("nothing follows Settled", async () => {
      const policyId = await createFundedPolicy(d);
      await d.settlement.trigger(policyId);

      await expect(d.settlement.trigger(policyId)).to.be.revertedWithCustomError(d.registry, "IllegalTransition");
      await expect(d.registry.connect(d.creator).refund(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "IllegalTransition",
      );
    });

    it("nothing follows Refunded", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: 60 });
      await advance(120);
      await d.registry.expire(policyId);
      await d.registry.connect(d.creator).refund(policyId);
      expect(await d.registry.stateOf(policyId)).to.equal(State.Refunded);

      await expect(d.registry.connect(d.creator).refund(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "IllegalTransition",
      );
      await expect(d.settlement.trigger(policyId)).to.be.reverted;
      await expect(d.registry.expire(policyId)).to.be.revertedWithCustomError(d.registry, "IllegalTransition");
    });

    it("expire cannot run twice", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: 60 });
      await advance(120);
      await d.registry.expire(policyId);
      await expect(d.registry.expire(policyId)).to.be.revertedWithCustomError(d.registry, "IllegalTransition");
    });
  });

  describe("the deadline boundary", () => {
    it("a policy cannot be created with an expiry already in the past", async () => {
      const { HBAR_USD, at18, chainNow } = await import("./helpers");
      const past = (await chainNow()) - 1;
      await expect(
        d.registry
          .connect(d.creator)
          .createPolicy(d.beneficiary.address, HBAR_USD, at18("0.08"), true, 0n, past),
      ).to.be.revertedWithCustomError(d.registry, "ExpiryInPast");
    });

    it("a policy well inside its window settles normally", async () => {
      const policyId = await createFundedPolicy(d, { expiryInSeconds: DAY });
      await advance(60);
      await expect(d.settlement.trigger(policyId)).to.not.be.reverted;
      expect(await d.registry.stateOf(policyId)).to.equal(State.Settled);
    });
  });
});
