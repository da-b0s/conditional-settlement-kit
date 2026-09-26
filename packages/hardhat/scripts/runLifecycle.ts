/**
 * Run one complete policy lifecycle against live Hedera testnet.
 *
 *     yarn lifecycle --network hederaTestnet
 *
 * Creates a policy against the real HBAR/USD Chainlink feed, funds it,
 * settles it FROM AN UNRELATED ACCOUNT, and prints HashScan links for every
 * transaction. That output is what EVIDENCE.md is built from.
 *
 * ---------------------------------------------------------------------------
 * WHY IT CREATES A THIRD ACCOUNT
 *
 * The claim being demonstrated is that settlement is permissionless: the
 * decision rests on what the price source says, not on who is asking. Proving
 * that with the creator's own key proves nothing — of course the creator can
 * settle their own policy. So this funds a throwaway account that is neither
 * the creator nor the beneficiary, and settles from there.
 *
 * On Hedera, sending HBAR to an unknown EVM address auto-creates an account
 * for it, so no AccountCreateTransaction is needed and no Hiero SDK call is
 * involved — this whole script runs over the JSON-RPC relay.
 * ---------------------------------------------------------------------------
 *
 * It spends real testnet HBAR: roughly 1 HBAR of escrow, which the
 * beneficiary keeps, plus a few HBAR of gas and funding.
 */
import * as dotenv from "dotenv";
import { ethers } from "hardhat";
import type { ChainlinkPriceSource, PolicyRegistry, Settlement } from "../typechain-types";
import { hbarAmount } from "../../nextjs/lib/settlement/units";

dotenv.config();

const HBAR_USD = ethers.keccak256(ethers.toUtf8Bytes("HBAR/USD"));

/**
 * One HBAR, in BOTH units.
 *
 * `txValue` (1e18) goes in the transaction's value field. `contractAmount`
 * (1e8 on Hedera) is what the contract will see in msg.value, and therefore
 * what maxPayout has to be denominated in. Using parseEther for both is what
 * produced PayoutExceedsEscrow(1, 1000000000000000000, 100000000) — see
 * lib/settlement/units.ts.
 */
const ONE_HBAR = "1";
/**
 * Funding for the settler. Generous on purpose.
 *
 * Hedera prices gas around 1,100 gwei, so a 500k-gas call costs about 0.55
 * HBAR — but the relay reserves gasLimit x gasPrice up front, and the settler
 * is a HOLLOW account (created by a transfer to an EVM address, so it carries
 * no key until its first transaction completes it), which costs more again.
 * At 3 HBAR with a 1.5M gas limit the relay answered "Insufficient funds for
 * transfer" despite the arithmetic fitting. 10 HBAR and a tighter limit
 * removes the question.
 */
const SETTLER_FUNDING = ethers.parseEther("10");

/**
 * Gas for trigger(). Measured, not guessed, and far above the local figure.
 *
 * The same call costs 111,226 gas on a Hardhat node. On Hedera it ran out at
 * a 500,000 limit having burned 488,758 — because trigger() reaches through
 * Settlement into ChainlinkPriceSource and then into the real aggregator
 * contract, and cross-contract calls on Hedera are charged far more heavily
 * than the EVM estimate suggests. Budget multiples, not margins.
 */
const TRIGGER_GAS = 3_000_000;

const hashscan = (kind: string, id: string) => `https://hashscan.io/testnet/${kind}/${id}`;

async function main() {
  const [creator] = await ethers.getSigners();
  const provider = ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  const { txValue: payoutTxValue, contractAmount: payoutContractAmount } = hbarAmount(ONE_HBAR, chainId);

  const registry = await ethers.getContract<PolicyRegistry>("PolicyRegistry", creator);
  const settlementRead = await ethers.getContract<Settlement>("Settlement", creator);
  const registryAddress = await registry.getAddress();
  const settlementAddress = await settlementRead.getAddress();

  console.log(`creator     ${creator.address}`);
  console.log(`registry    ${registryAddress}`);
  console.log(`settlement  ${settlementAddress}\n`);

  // Two throwaway accounts: one to be paid, one to do the settling.
  const beneficiary = ethers.Wallet.createRandom().connect(provider);
  const settler = ethers.Wallet.createRandom().connect(provider);
  console.log(`beneficiary ${beneficiary.address}  (will be paid)`);
  console.log(`settler     ${settler.address}  (neither creator nor beneficiary)\n`);

  const steps: { what: string; hash: string }[] = [];
  const record = async (what: string, tx: { hash: string; wait: () => Promise<unknown> }) => {
    await tx.wait();
    steps.push({ what, hash: tx.hash });
    console.log(`  ${what.padEnd(34)} ${tx.hash}`);
    return tx.hash;
  };

  // What does the feed actually say right now? The threshold is picked from
  // this, so the policy is guaranteed to be settleable rather than hopeful.
  const source = await ethers.getContract<ChainlinkPriceSource>("ChainlinkPriceSource", creator);
  const observation = await source.latest(HBAR_USD);
  const price18 = BigInt(observation.value);
  const observedAt = Number(observation.observedAt);
  console.log(`\nHBAR/USD reads ${ethers.formatUnits(price18, 18)} at 18dp`);
  console.log(`  feed updated ${new Date(observedAt * 1000).toISOString()}`);
  console.log(`  bound for this feed: ${await source.maxAgeOf(HBAR_USD)}s\n`);

  // Half the current price: comfortably met, and it cannot be met by accident
  // in the other direction.
  const threshold = price18 / 2n;
  const expiry = Math.floor(Date.now() / 1000) + 3600;

  console.log("transactions");
  await record(
    "fund the settler",
    await creator.sendTransaction({ to: settler.address, value: SETTLER_FUNDING, gasLimit: 2_000_000 }),
  );

  await record(
    "createPolicy",
    await registry.createPolicy(beneficiary.address, HBAR_USD, threshold, true, payoutContractAmount, expiry, {
      gasLimit: 1_000_000,
    }),
  );
  const policyId = (await registry.nextPolicyId()) - 1n;

  await record("fund the escrow", await registry.fund(policyId, { value: payoutTxValue, gasLimit: 1_000_000 }));

  const state = await registry.stateOf(policyId);
  console.log(`\n  policy #${policyId} state=${state} (2=Active)`);
  if (state !== 2n) throw new Error(`expected Active after funding, got ${state}`);

  const before = await provider.getBalance(beneficiary.address);

  // THE POINT: an account with no relationship to this policy settles it.
  const settlementAsStranger = settlementRead.connect(settler);
  const triggerHash = await record(
    "trigger() — by the stranger",
    await settlementAsStranger.trigger(policyId, { gasLimit: TRIGGER_GAS }),
  );

  const after = await provider.getBalance(beneficiary.address);
  const finalState = await registry.stateOf(policyId);
  const policy = await registry.getPolicy(policyId);

  console.log(`\n  policy #${policyId} state=${finalState} (4=Settled)`);
  console.log(`  beneficiary +${ethers.formatEther(after - before)} HBAR`);
  console.log(`  settled on price ${ethers.formatUnits(policy.triggerPrice, 18)}`);

  if (finalState !== 4n) throw new Error(`expected Settled, got ${finalState}`);
  // The beneficiary's BALANCE is reported by the relay in weibar, so it is
  // compared against the tx-value form, not the contract form.
  if (after - before !== payoutTxValue) {
    throw new Error(`beneficiary got ${after - before} weibar, expected ${payoutTxValue}`);
  }

  // I1, against the live chain rather than a local fixture.
  process.stdout.write("\n  second trigger() ... ");
  try {
    await (await settlementAsStranger.trigger(policyId, { gasLimit: TRIGGER_GAS })).wait();
    throw new Error("SECOND TRIGGER SUCCEEDED — I1 VIOLATED");
  } catch (error) {
    if (error instanceof Error && error.message.includes("I1 VIOLATED")) throw error;
    console.log("reverted (I1 holds)");
  }

  console.log("\n--- for EVIDENCE.md ---\n");
  console.log(`| Step | Transaction |`);
  console.log(`| --- | --- |`);
  for (const step of steps)
    console.log(`| ${step.what} | [${step.hash.slice(0, 18)}…](${hashscan("transaction", step.hash)}) |`);
  console.log(`\npolicy id      ${policyId}`);
  console.log(`registry       ${hashscan("contract", registryAddress)}`);
  console.log(`settlement     ${hashscan("contract", settlementAddress)}`);
  console.log(`beneficiary    ${hashscan("account", beneficiary.address)}`);
  console.log(`settler        ${hashscan("account", settler.address)}`);
  console.log(`trigger tx     ${hashscan("transaction", triggerHash)}`);
}

main().catch(error => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
