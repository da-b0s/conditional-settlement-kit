/**
 * I1 — A policy settles at most once.
 *
 * "Repeated evidence, repeated clicks or a replayed observation cannot pay
 * twice."
 *
 * This is the invariant that costs real money when it breaks, and the one
 * most easily broken by a well-meaning refactor: someone adds a `paid`
 * boolean, forgets to set it on one path, and the contract pays twice.
 *
 * The design avoids that by having no flag at all. `Settled` is a state, the
 * only legal move into it is from `Triggered`, and the transition guard
 * rejects the second attempt. There is nothing to forget to set.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { State, at18, createFundedPolicy, deploySystem, type Deployed } from "./helpers";

describe("I1 — a policy settles at most once", () => {
  let d: Deployed;

  beforeEach(async () => {
    // Price 0.0891 against a 0.0800 threshold: the condition is met.
    d = await deploySystem("0.0891");
  });

  it("pays the beneficiary on the first trigger", async () => {
    const policyId = await createFundedPolicy(d);
    const before = await ethers.provider.getBalance(d.beneficiary.address);

    await d.settlement.connect(d.stranger).trigger(policyId);

    const after = await ethers.provider.getBalance(d.beneficiary.address);
    expect(after - before).to.equal(ethers.parseEther("1"));
    expect(await d.registry.stateOf(policyId)).to.equal(State.Settled);
  });

  it("THE INVARIANT: a second trigger reverts and moves nothing", async () => {
    const policyId = await createFundedPolicy(d);
    await d.settlement.connect(d.stranger).trigger(policyId);

    const balanceAfterFirst = await ethers.provider.getBalance(d.beneficiary.address);

    await expect(d.settlement.connect(d.stranger).trigger(policyId)).to.be.revertedWithCustomError(
      d.registry,
      "IllegalTransition",
    );

    expect(await ethers.provider.getBalance(d.beneficiary.address)).to.equal(balanceAfterFirst);
  });

  it("a replayed observation cannot pay again, even from the original creator", async () => {
    const policyId = await createFundedPolicy(d);
    await d.settlement.connect(d.creator).trigger(policyId);

    await expect(d.settlement.connect(d.creator).trigger(policyId)).to.be.revertedWithCustomError(
      d.registry,
      "IllegalTransition",
    );
  });

  it("the registry holds nothing for a settled policy", async () => {
    const policyId = await createFundedPolicy(d);
    await d.settlement.connect(d.stranger).trigger(policyId);

    const p = await d.registry.getPolicy(policyId);
    expect(p.escrow).to.equal(0n);
    expect(await d.registry.totalEscrowed()).to.equal(0n);
  });

  it("settling one policy does not touch another", async () => {
    const first = await createFundedPolicy(d);
    const second = await createFundedPolicy(d);

    await d.settlement.connect(d.stranger).trigger(first);

    expect(await d.registry.stateOf(first)).to.equal(State.Settled);
    expect(await d.registry.stateOf(second)).to.equal(State.Active);
    const p2 = await d.registry.getPolicy(second);
    expect(p2.escrow).to.equal(ethers.parseEther("1"));
  });

  it("the registry refuses a direct settle from anyone but Settlement", async () => {
    // Belt and braces: even if trigger() were bypassed entirely, the payout
    // path is not reachable without going through the settlement contract.
    const policyId = await createFundedPolicy(d);
    await expect(d.registry.connect(d.stranger).settle(policyId)).to.be.revertedWithCustomError(
      d.registry,
      "NotSettlement",
    );
  });

  it("a policy that was never triggered cannot be settled", async () => {
    const policyId = await createFundedPolicy(d, { thresholdHuman: "9.0000" });
    // Condition not met, so trigger refuses before any state change.
    await expect(d.settlement.trigger(policyId)).to.be.revertedWithCustomError(d.settlement, "ConditionNotMet");
    expect(await d.registry.stateOf(policyId)).to.equal(State.Active);
  });

  it("the threshold boundary is inclusive, and only just", async () => {
    // Exactly at the threshold must trigger; one wei of price below must not.
    const exact = await createFundedPolicy(d, { thresholdHuman: "0.0891" });
    expect(await d.registry.conditionMet(exact, at18("0.0891"))).to.equal(true);
    expect(await d.registry.conditionMet(exact, at18("0.0891") - 1n)).to.equal(false);
  });
});
