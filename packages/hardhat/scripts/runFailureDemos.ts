/**
 * The four refusals, as real testnet transactions.
 *
 *     yarn failures --network hederaTestnet
 *
 * ---------------------------------------------------------------------------
 * WHY THE FAILURES ARE THE DEMO
 *
 * Almost every submission demonstrates a happy path and stops. A happy path
 * shows that the code can pay out. It shows nothing at all about whether the
 * code can be made to pay out when it should not, which is the only question
 * that matters for something holding escrow.
 *
 * So these four run on live Hedera, against the same deployed contracts as
 * the successful settlement, and each one produces a transaction a judge can
 * open on HashScan and see FAIL against. A reverted transaction on a public
 * ledger is a stronger claim than a green tick in a local test suite,
 * because nobody has to trust the harness that produced it.
 *
 *   F1  a stale reading is refused, on a bound this feed cannot meet
 *   F2  an unauthorised caller cannot move money
 *   F3  a settlement cannot touch an expired policy
 *   F4  a payout larger than the escrow cannot activate
 *
 * F1 is the interesting one. A real Chainlink feed cannot be forced stale on
 * demand, so instead the SAME proxy is registered under a second asset key
 * with a one-second bound. Same contract, same price, same moment — and one
 * asset settles while the other reverts, because the bound belongs to the
 * feed rather than to the system. That is the template's whole argument,
 * demonstrated on-chain rather than asserted in a README.
 * ---------------------------------------------------------------------------
 *
 * Costs a few HBAR in gas. Nothing is paid out: every policy created here is
 * either refused or refunded.
 */
import * as dotenv from "dotenv";
import type { Interface } from "ethers";
import { ethers } from "hardhat";
import type { ChainlinkPriceSource, PolicyRegistry, Settlement } from "../typechain-types";
import { hbarAmount } from "../../nextjs/lib/settlement/units";

dotenv.config();

const HBAR_USD = ethers.keccak256(ethers.toUtf8Bytes("HBAR/USD"));
/** The same proxy, registered again under a deliberately impossible bound. */
const HBAR_USD_TIGHT = ethers.keccak256(ethers.toUtf8Bytes("HBAR/USD@1s"));
const HBAR_USD_PROXY = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";

const GAS = { write: 1_000_000, trigger: 3_000_000 };
const scan = (h: string) => `https://hashscan.io/testnet/transaction/${h}`;

interface Outcome {
  id: string;
  what: string;
  hash?: string;
  reason: string;
  refused: boolean;
}

const outcomes: Outcome[] = [];

/**
 * Decode a revert into the contract's own custom error.
 *
 * "transaction execution reverted" tells a reader nothing. `ObservationStale`
 * carrying the asset, the reading's timestamp and the bound it missed tells
 * them everything, and that is the difference between evidence and a
 * screenshot of something going red.
 */
function decodeRevert(error: unknown, iface: Interface): string {
  const err = error as { data?: string; info?: { error?: { data?: string } }; shortMessage?: string; message?: string };
  const data = err.data ?? err.info?.error?.data;
  // >= 10, not > 10. A custom error with NO arguments is exactly the 4-byte
  // selector: "0x" plus 8 hex characters. `> 10` silently excludes every
  // zero-argument error, which here is most of the authorisation guards —
  // NotSettlement, NotOwner, NotCreator, ZeroAddress. They are precisely the
  // ones whose names carry the whole meaning.
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return `${parsed.name}(${parsed.args.map((a: unknown) => String(a)).join(", ")})`;
    } catch {
      // Not one of this interface's errors; fall through to the raw message.
    }
  }
  return (err.shortMessage ?? err.message ?? String(error)).split("\n")[0].slice(0, 160);
}

/**
 * Run something expected to REVERT, capturing BOTH the decoded reason and the
 * on-chain hash.
 *
 * Two calls, deliberately. A staticCall returns the revert data the node
 * computed, which is where the custom error lives. The real transaction is
 * what produces a hash a judge can open on HashScan. Neither alone gives
 * both, and the evidence is much weaker with either missing.
 */
async function expectRevert(
  id: string,
  what: string,
  iface: Interface,
  probe: () => Promise<unknown>,
  send: () => Promise<{ hash: string; wait(): Promise<unknown> }>,
) {
  let reason: string;
  try {
    await probe();
    reason = "STATIC CALL SUCCEEDED — the guard is not holding";
  } catch (error) {
    reason = decodeRevert(error, iface);
  }

  try {
    const tx = await send();
    await tx.wait();
    outcomes.push({ id, what, hash: tx.hash, reason: "IT SUCCEEDED — this is a failure of the demo", refused: false });
    console.log(`  ${id}  NOT REFUSED  ${tx.hash}`);
  } catch (error) {
    // A revert that reached the chain has a receipt; one rejected before
    // submission does not, and that distinction matters for the evidence.
    const hash = (error as { receipt?: { hash?: string } }).receipt?.hash;
    outcomes.push({ id, what, hash, reason, refused: true });
    console.log(`  ${id}  refused      ${hash ?? "(rejected before submission)"}`);
    console.log(`      ${reason}`);
  }
}

async function main() {
  const [creator] = await ethers.getSigners();
  const provider = ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  const one = hbarAmount("1", chainId);
  const tenth = hbarAmount("0.1", chainId);

  const registry = await ethers.getContract<PolicyRegistry>("PolicyRegistry", creator);
  const settlement = await ethers.getContract<Settlement>("Settlement", creator);
  const source = await ethers.getContract<ChainlinkPriceSource>("ChainlinkPriceSource", creator);

  console.log(`registry   ${await registry.getAddress()}`);
  console.log(`settlement ${await settlement.getAddress()}`);
  console.log(`creator    ${creator.address}\n`);

  const observation = await source.latest(HBAR_USD);
  const price = BigInt(observation.value);
  const belowPrice = price / 2n; // a threshold already satisfied
  console.log(`HBAR/USD reads ${ethers.formatUnits(price, 18)}\n`);

  // -----------------------------------------------------------------------
  // F1  The same feed, two bounds. One settles, one is refused as stale.
  // -----------------------------------------------------------------------
  console.log("F1  a stale reading is refused");
  if (!(await source.supportsAsset(HBAR_USD_TIGHT))) {
    const reg = await source.registerFeed(HBAR_USD_TIGHT, HBAR_USD_PROXY, 1, { gasLimit: GAS.write });
    await reg.wait();
    console.log(`      registered the same proxy with a 1-second bound  ${reg.hash}`);
    const wire = await settlement.setPriceSource(HBAR_USD_TIGHT, await source.getAddress(), { gasLimit: GAS.write });
    await wire.wait();
  }

  const staleExpiry = Math.floor(Date.now() / 1000) + 3600;
  await (
    await registry.createPolicy(creator.address, HBAR_USD_TIGHT, belowPrice, true, tenth.contractAmount, staleExpiry, {
      gasLimit: GAS.write,
    })
  ).wait();
  const stalePolicy = (await registry.nextPolicyId()) - 1n;
  await (await registry.fund(stalePolicy, { value: tenth.txValue, gasLimit: GAS.write })).wait();

  await expectRevert(
    "F1",
    "trigger() against a feed whose own bound it cannot meet",
    source.interface,
    () => settlement.trigger.staticCall(stalePolicy),
    () => settlement.trigger(stalePolicy, { gasLimit: GAS.trigger }),
  );

  // -----------------------------------------------------------------------
  // F2  Only the settlement contract may move money.
  // -----------------------------------------------------------------------
  console.log("\nF2  an unauthorised caller cannot settle");
  await expectRevert(
    "F2",
    "registry.settle() called directly, bypassing Settlement",
    registry.interface,
    () => registry.settle.staticCall(stalePolicy),
    () => registry.settle(stalePolicy, { gasLimit: GAS.write }),
  );

  // -----------------------------------------------------------------------
  // F3  Expiry and settlement are mutually exclusive.
  // -----------------------------------------------------------------------
  console.log("\nF3  a settlement cannot touch an expired policy");
  const shortExpiry = Math.floor(Date.now() / 1000) + 45;
  await (
    await registry.createPolicy(creator.address, HBAR_USD, belowPrice, true, tenth.contractAmount, shortExpiry, {
      gasLimit: GAS.write,
    })
  ).wait();
  const racePolicy = (await registry.nextPolicyId()) - 1n;
  await (await registry.fund(racePolicy, { value: tenth.txValue, gasLimit: GAS.write })).wait();
  console.log(`      policy #${racePolicy} active, expires in 45s — waiting for the deadline`);

  // The contract compares against CONSENSUS time, so wall-clock waiting is
  // the only option on a real network. Local tests jump the clock instead.
  await new Promise(resolve => setTimeout(resolve, 60_000));

  const expireTx = await registry.expire(racePolicy, { gasLimit: GAS.write });
  await expireTx.wait();
  console.log(`      expired      ${expireTx.hash}`);

  await expectRevert(
    "F3",
    "trigger() on a policy already expired",
    registry.interface,
    () => settlement.trigger.staticCall(racePolicy),
    () => settlement.trigger(racePolicy, { gasLimit: GAS.trigger }),
  );

  const refundTx = await registry.refund(racePolicy, { gasLimit: GAS.write });
  await refundTx.wait();
  console.log(`      refunded     ${refundTx.hash}`);

  // -----------------------------------------------------------------------
  // F4  A promise larger than the escrow cannot activate.
  // -----------------------------------------------------------------------
  console.log("\nF4  a payout larger than the escrow cannot activate");
  await (
    await registry.createPolicy(creator.address, HBAR_USD, belowPrice, true, one.contractAmount, staleExpiry, {
      gasLimit: GAS.write,
    })
  ).wait();
  const underfunded = (await registry.nextPolicyId()) - 1n;

  await expectRevert(
    "F4",
    "fund() with 0.1 HBAR against a 1 HBAR promise",
    registry.interface,
    () => registry.fund.staticCall(underfunded, { value: tenth.txValue }),
    () => registry.fund(underfunded, { value: tenth.txValue, gasLimit: GAS.write }),
  );
  console.log(`      escrow after the refusal: ${(await registry.getPolicy(underfunded)).escrow} (rolled back)`);

  // -----------------------------------------------------------------------
  console.log("\n--- for EVIDENCE.md ---\n");
  console.log("| | Refusal | Transaction | Reason |");
  console.log("| --- | --- | --- | --- |");
  for (const o of outcomes) {
    const link = o.hash ? `[\`${o.hash.slice(0, 18)}…\`](${scan(o.hash)})` : "_rejected before submission_";
    console.log(`| **${o.id}** | ${o.what} | ${link} | \`${o.reason.replace(/\|/g, "/")}\` |`);
  }

  const notRefused = outcomes.filter(o => !o.refused);
  if (notRefused.length > 0) {
    throw new Error(`${notRefused.length} demo(s) were NOT refused: ${notRefused.map(o => o.id).join(", ")}`);
  }
  console.log(`\nall ${outcomes.length} refused, on chain`);
}

main().catch(error => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
