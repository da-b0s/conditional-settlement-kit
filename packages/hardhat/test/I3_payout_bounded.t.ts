/**
 * I3 — Payout never exceeds funded escrow. Fees and rounding are bounded and
 * documented.
 *
 * The check lives at funding time rather than at settlement time, and that
 * placement is the point: a beneficiary can read `state == Active` and know
 * the money is already there. A system that only checks when paying leaves
 * the beneficiary holding a promise it cannot keep, and they find out at the
 * worst possible moment.
 *
 * There is a second, redundant clamp inside settle(). It should be
 * unreachable. It is there because "should be unreachable" is not a
 * guarantee, and the failure it would prevent is paying out money that was
 * never deposited.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  HBAR_USD,
  HOUR,
  State,
  advance,
  at18,
  chainNow,
  createFundedPolicy,
  deploySystem,
  type Deployed,
} from "./helpers";

describe("I3 — payout never exceeds escrow", () => {
  let d: Deployed;

  beforeEach(async () => {
    d = await deploySystem("0.0891");
  });

  it("THE INVARIANT: a policy promising more than it holds cannot activate", async () => {
    const expiry = (await chainNow()) + 86_400;
    const tx = await d.registry
      .connect(d.creator)
      .createPolicy(d.beneficiary.address, HBAR_USD, at18("0.08"), true, ethers.parseEther("5"), expiry);
    const receipt = await tx.wait();
    const policyId = receipt!.logs
      .map(l => {
        try {
          return d.registry.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find(p => p?.name === "PolicyCreated")!.args[0] as bigint;

    // Promises 5, funds 1.
    await expect(
      d.registry.connect(d.creator).fund(policyId, { value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(d.registry, "PayoutExceedsEscrow");

    // And it stays in Draft, so nobody can mistake it for live cover.
    expect(await d.registry.stateOf(policyId)).to.equal(State.Draft);
  });

  it("activates once the escrow catches up with the promise", async () => {
    const policyId = await createFundedPolicy(d, {
      payout: ethers.parseEther("2"),
      escrow: ethers.parseEther("2"),
    });
    expect(await d.registry.stateOf(policyId)).to.equal(State.Active);
  });

  it("pays exactly the payout, not the whole escrow", async () => {
    const policyId = await createFundedPolicy(d, {
      payout: ethers.parseEther("1"),
      escrow: ethers.parseEther("3"),
    });

    const beneficiaryBefore = await ethers.provider.getBalance(d.beneficiary.address);
    const creatorBefore = await ethers.provider.getBalance(d.creator.address);

    // Triggered by a third party so gas does not muddy either balance.
    await expect(d.settlement.connect(d.stranger).trigger(policyId))
      .to.emit(d.registry, "SurplusCredited")
      .withArgs(policyId, d.creator.address, ethers.parseEther("2"));

    expect((await ethers.provider.getBalance(d.beneficiary.address)) - beneficiaryBefore).to.equal(
      ethers.parseEther("1"),
    );
    // The surplus is credited to the creator, not pushed: nothing arrives yet.
    expect(await ethers.provider.getBalance(d.creator.address)).to.equal(creatorBefore);
    expect(await d.registry.withdrawable(d.creator.address)).to.equal(ethers.parseEther("2"));

    // The creator claims it in a separate call.
    const receipt = await (await d.registry.connect(d.creator).withdraw()).wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    expect((await ethers.provider.getBalance(d.creator.address)) - creatorBefore + gas).to.equal(
      ethers.parseEther("2"),
    );
    expect(await d.registry.withdrawable(d.creator.address)).to.equal(0n);
    expect(await d.registry.totalWithdrawable()).to.equal(0n);
  });

  it("withdrawing with no balance reverts rather than succeeding silently", async () => {
    await expect(d.registry.connect(d.stranger).withdraw()).to.be.revertedWithCustomError(
      d.registry,
      "NothingToWithdraw",
    );
  });

  it("a creator that refuses HBAR cannot block the beneficiary's payout", async () => {
    // The attack this closes: overfund by a little, refuse the surplus so
    // settle() reverts, wait out the deadline, refund the lot.
    const griefer = await ethers.deployContract("RejectingCreator", [await d.registry.getAddress()]);
    const expiry = (await chainNow()) + 86_400;
    const policyId = await griefer.createAndFund.staticCall(
      d.beneficiary.address,
      HBAR_USD,
      at18("0.08"),
      true,
      ethers.parseEther("1"),
      expiry,
      { value: ethers.parseEther("1") + 1n },
    );
    await griefer.createAndFund(d.beneficiary.address, HBAR_USD, at18("0.08"), true, ethers.parseEther("1"), expiry, {
      value: ethers.parseEther("1") + 1n,
    });
    await griefer.setRejecting(true);

    const beneficiaryBefore = await ethers.provider.getBalance(d.beneficiary.address);
    await d.settlement.connect(d.stranger).trigger(policyId);

    expect(await d.registry.stateOf(policyId)).to.equal(State.Settled);
    expect((await ethers.provider.getBalance(d.beneficiary.address)) - beneficiaryBefore).to.equal(
      ethers.parseEther("1"),
    );
    // The surplus waits for the creator; refusing it only hurts the creator.
    expect(await d.registry.withdrawable(await griefer.getAddress())).to.equal(1n);
    await expect(griefer.withdraw()).to.be.revertedWithCustomError(d.registry, "TransferFailed");
    await griefer.setRejecting(false);
    await griefer.withdraw();
    expect(await d.registry.withdrawable(await griefer.getAddress())).to.equal(0n);
  });

  it("the registry never holds less than it owes", async () => {
    const a = await createFundedPolicy(d, { escrow: ethers.parseEther("1"), payout: ethers.parseEther("1") });
    const b = await createFundedPolicy(d, { escrow: ethers.parseEther("2"), payout: ethers.parseEther("2") });
    // Surplus becomes a withdrawable balance, which the registry must still hold.
    const c = await createFundedPolicy(d, { escrow: ethers.parseEther("3"), payout: ethers.parseEther("1") });
    await d.settlement.trigger(c);
    expect(await d.registry.totalWithdrawable()).to.equal(ethers.parseEther("2"));
    expect(await ethers.provider.getBalance(await d.registry.getAddress())).to.be.greaterThanOrEqual(
      (await d.registry.totalEscrowed()) + (await d.registry.totalWithdrawable()),
    );

    const owed = await d.registry.totalEscrowed();
    const held = await ethers.provider.getBalance(await d.registry.getAddress());
    expect(held).to.be.greaterThanOrEqual(owed);
    expect(owed).to.equal(ethers.parseEther("3"));

    await d.settlement.trigger(a);
    expect(await d.registry.totalEscrowed()).to.equal(ethers.parseEther("2"));
    expect(await ethers.provider.getBalance(await d.registry.getAddress())).to.be.greaterThanOrEqual(
      await d.registry.totalEscrowed(),
    );

    await d.settlement.trigger(b);
    expect(await d.registry.totalEscrowed()).to.equal(0n);
    // The unclaimed surplus is still fully held.
    expect(await ethers.provider.getBalance(await d.registry.getAddress())).to.be.greaterThanOrEqual(
      await d.registry.totalWithdrawable(),
    );
  });

  it("rejects a partial first deposit and activates only on a fully funded deposit", async () => {
    const expiry = (await chainNow()) + 86_400;
    const tx = await d.registry
      .connect(d.creator)
      .createPolicy(d.beneficiary.address, HBAR_USD, at18("0.08"), true, ethers.parseEther("2"), expiry);
    const policyId = (await tx.wait())!.logs
      .map(l => {
        try {
          return d.registry.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find(p => p?.name === "PolicyCreated")!.args[0] as bigint;

    // First instalment is short, so it must not activate.
    await expect(
      d.registry.connect(d.creator).fund(policyId, { value: ethers.parseEther("1") }),
    ).to.be.revertedWithCustomError(d.registry, "PayoutExceedsEscrow");
    expect(await d.registry.stateOf(policyId)).to.equal(State.Draft);

    // The full amount activates it.
    await d.registry.connect(d.creator).fund(policyId, { value: ethers.parseEther("2") });
    expect(await d.registry.stateOf(policyId)).to.equal(State.Active);
  });

  it("a zero-value funding attempt is refused rather than silently ignored", async () => {
    const policyId = await createFundedPolicy(d);
    await expect(d.registry.connect(d.creator).fund(policyId, { value: 0 })).to.be.revertedWithCustomError(
      d.registry,
      "NothingToFund",
    );
  });

  it("a zero payout is legal and pays nothing while still settling", async () => {
    // Degenerate but valid: the policy exists to record that a condition was
    // met. It must not leave value stranded.
    const policyId = await createFundedPolicy(d, { payout: 0n, escrow: ethers.parseEther("1") });
    const creatorBefore = await ethers.provider.getBalance(d.creator.address);

    await d.settlement.connect(d.stranger).trigger(policyId);

    expect(await d.registry.stateOf(policyId)).to.equal(State.Settled);
    // Nothing is stranded: the whole escrow is the creator's to withdraw.
    expect(await ethers.provider.getBalance(d.creator.address)).to.equal(creatorBefore);
    expect(await d.registry.withdrawable(d.creator.address)).to.equal(ethers.parseEther("1"));
    expect(await d.registry.totalEscrowed()).to.equal(0n);
  });

  describe("a Draft policy holds nothing, and can still be cleaned up", () => {
    /**
     * The obvious worry about Draft is stranded escrow: fund a 10 HBAR policy
     * with 3, sit in Draft forever, never get the 3 back. It cannot happen,
     * and the reason is worth pinning rather than assuming.
     *
     * `fund()` reverts when a payment would leave a Draft policy short of
     * maxPayout, and the revert rolls back the escrow increment with it. So
     * partial funding is not a state this contract can reach.
     *
     * The stranded-escrow test got written first. It failed, because the
     * underfunding reverted — which is the right outcome, and this is what
     * the test became.
     */
    it("THE INVARIANT: underfunding reverts, so a Draft policy holds exactly zero", async () => {
      const d = await deploySystem();
      const expiry = (await chainNow()) + HOUR;
      await d.registry
        .connect(d.creator)
        .createPolicy(d.beneficiary.address, HBAR_USD, at18("1"), true, at18("10"), expiry);
      const policyId = (await d.registry.nextPolicyId()) - 1n;

      await expect(d.registry.connect(d.creator).fund(policyId, { value: at18("3") })).to.be.revertedWithCustomError(
        d.registry,
        "PayoutExceedsEscrow",
      );

      // The escrow increment rolled back with the revert. Nothing is held.
      expect((await d.registry.getPolicy(policyId)).escrow).to.equal(0n);
      expect(await d.registry.totalEscrowed()).to.equal(0n);
      expect(await d.registry.stateOf(policyId)).to.equal(State.Draft);
    });

    it("an abandoned Draft reaches a terminal state instead of sitting forever", async () => {
      const d = await deploySystem();
      const expiry = (await chainNow()) + HOUR;
      await d.registry
        .connect(d.creator)
        .createPolicy(d.beneficiary.address, HBAR_USD, at18("1"), true, at18("10"), expiry);
      const policyId = (await d.registry.nextPolicyId()) - 1n;

      await advance(HOUR + 1);
      await d.registry.connect(d.stranger).expire(policyId);
      expect(await d.registry.stateOf(policyId)).to.equal(State.Expired);

      await d.registry.connect(d.creator).refund(policyId);
      expect(await d.registry.stateOf(policyId)).to.equal(State.Refunded);
      expect(await d.registry.totalEscrowed()).to.equal(0n);
    });

    it("a Draft policy still cannot be expired before its deadline", async () => {
      const d = await deploySystem();
      const expiry = (await chainNow()) + HOUR;
      await d.registry
        .connect(d.creator)
        .createPolicy(d.beneficiary.address, HBAR_USD, at18("1"), true, at18("10"), expiry);
      const policyId = (await d.registry.nextPolicyId()) - 1n;

      await expect(d.registry.connect(d.stranger).expire(policyId)).to.be.revertedWithCustomError(
        d.registry,
        "NotYetExpired",
      );
    });

    it("expiring a Draft policy does not make it settleable", async () => {
      // I5 must survive the new edge: Expired is Expired however it got there.
      const d = await deploySystem();
      const expiry = (await chainNow()) + HOUR;
      await d.registry
        .connect(d.creator)
        .createPolicy(d.beneficiary.address, HBAR_USD, at18("0.01"), true, at18("10"), expiry);
      const policyId = (await d.registry.nextPolicyId()) - 1n;

      await advance(HOUR + 1);
      await d.registry.connect(d.stranger).expire(policyId);

      await expect(d.settlement.connect(d.stranger).trigger(policyId)).to.be.reverted;
      expect(await d.registry.stateOf(policyId)).to.equal(State.Expired);
    });
  });
});

describe("Funding window", () => {
  let d: Deployed;
  const deposit = ethers.parseEther("1");

  beforeEach(async () => {
    d = await deploySystem();
  });

  async function snapshot(policyId: bigint) {
    return {
      policy: Array.from(await d.registry.getPolicy(policyId)),
      total: await d.registry.totalEscrowed(),
      held: await ethers.provider.getBalance(await d.registry.getAddress()),
      creator: await ethers.provider.getBalance(d.creator.address),
      beneficiary: await ethers.provider.getBalance(d.beneficiary.address),
    };
  }

  for (const state of ["Triggered", "Settled", "Expired", "Refunded"] as const) {
    it(`refuses funding in ${state} without changing escrow or recipient balances`, async () => {
      // Leave another policy funded to catch accidental changes to aggregate escrow.
      await createFundedPolicy(d);
      const id = await createFundedPolicy(d, { expiryInSeconds: HOUR });
      if (state === "Triggered") {
        // Reach the normally atomic intermediate state through the authorized path.
        await d.registry.setSettlement(d.stranger.address);
        await d.registry.connect(d.stranger).markTriggered(id, at18("0.0891"), await chainNow());
      } else if (state === "Settled") {
        await d.settlement.connect(d.stranger).trigger(id);
      } else {
        const policy = await d.registry.getPolicy(id);
        await ethers.provider.send("evm_setNextBlockTimestamp", [Number(policy.expiry)]);
        await d.registry.connect(d.stranger).expire(id);
        if (state === "Refunded") await d.registry.connect(d.creator).refund(id);
      }
      expect(await d.registry.stateOf(id)).to.equal(State[state]);
      const before = await snapshot(id);
      await expect(d.registry.connect(d.stranger).fund(id, { value: deposit }))
        .to.be.revertedWithCustomError(d.registry, "FundingNotAllowed")
        .withArgs(id, State[state]);
      // The rejected sender can still pay gas; no deposit is retained or paid out.
      expect(await snapshot(id)).to.deep.equal(before);
    });
  }

  for (const state of ["Draft", "Active"] as const) {
    for (const offset of [-1, 0, 1]) {
      it(`${state}: funding ${offset} seconds from the deadline respects the boundary`, async () => {
        const expiry = (await chainNow()) + HOUR;
        await d.registry
          .connect(d.creator)
          .createPolicy(d.beneficiary.address, HBAR_USD, at18("0.08"), true, deposit, expiry);
        const id = (await d.registry.nextPolicyId()) - 1n;
        if (state === "Active") await d.registry.connect(d.creator).fund(id, { value: deposit });
        const before = await snapshot(id);
        await ethers.provider.send("evm_setNextBlockTimestamp", [expiry + offset]);
        const transaction = d.registry.connect(d.stranger).fund(id, { value: deposit });
        if (offset < 0) {
          await expect(transaction).to.emit(d.registry, "PolicyFunded");
          expect(await d.registry.stateOf(id)).to.equal(State.Active);
          expect((await d.registry.getPolicy(id)).escrow).to.equal(before.total + deposit);
          expect(await d.registry.totalEscrowed()).to.equal(before.total + deposit);
          expect(await ethers.provider.getBalance(await d.registry.getAddress())).to.equal(before.held + deposit);
        } else {
          await expect(transaction)
            .to.be.revertedWithCustomError(d.registry, "AlreadyExpired")
            .withArgs(id, expiry, expiry + offset);
          expect(await snapshot(id)).to.deep.equal(before);
        }
      });
    }
  }

  for (const outcome of ["settle", "refund"] as const) {
    it(`an Active top-up remains recoverable through ${outcome}`, async () => {
      const id = await createFundedPolicy(d, { expiryInSeconds: HOUR });
      await d.registry.connect(d.stranger).fund(id, { value: deposit });
      expect((await d.registry.getPolicy(id)).escrow).to.equal(deposit * 2n);
      const creatorBefore = await ethers.provider.getBalance(d.creator.address);
      if (outcome === "settle") {
        await expect(d.settlement.connect(d.stranger).trigger(id)).to.changeEtherBalances(
          [d.beneficiary, d.creator],
          [deposit, 0n],
        );
        // The top-up is credited to the creator and claimed with withdraw().
        expect(await ethers.provider.getBalance(d.creator.address)).to.equal(creatorBefore);
        expect(await d.registry.withdrawable(d.creator.address)).to.equal(deposit);
        await expect(d.registry.connect(d.creator).withdraw()).to.changeEtherBalance(d.creator, deposit);
      } else {
        await ethers.provider.send("evm_setNextBlockTimestamp", [Number((await d.registry.getPolicy(id)).expiry)]);
        await d.registry.connect(d.stranger).expire(id);
        await expect(d.registry.connect(d.creator).refund(id)).to.changeEtherBalance(d.creator, deposit * 2n);
      }
      expect((await d.registry.getPolicy(id)).escrow).to.equal(0n);
      expect(await d.registry.totalEscrowed()).to.equal(0n);
      expect(await ethers.provider.getBalance(await d.registry.getAddress())).to.equal(0n);
    });
  }
});
