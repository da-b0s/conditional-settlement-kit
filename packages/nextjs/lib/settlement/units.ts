/**
 * HBAR has two different decimal conventions, ten billion apart, and you need
 * both in the same transaction.
 *
 * ---------------------------------------------------------------------------
 * THE THING THAT WILL BITE YOU
 *
 * On Hedera, one HBAR is:
 *
 *     1_000000000_000000000   (1e18)  in a transaction's `value` field
 *             100_000000      (1e8)   in `msg.value` inside the EVM
 *
 * The JSON-RPC relay accepts `value` in weibar for Ethereum tooling
 * compatibility and divides by 10^10 before the transaction reaches the
 * network. By the time a contract reads `msg.value`, it is tinybar.
 *
 * So a contract that takes an amount as an ARGUMENT and compares it against
 * `msg.value` is comparing two different units unless the caller knows this.
 * That is exactly what happened here:
 *
 *     createPolicy(..., maxPayout: parseEther("1"))   // 1e18
 *     fund(policyId, { value: parseEther("1") })      // arrives as 1e8
 *     -> PayoutExceedsEscrow(1, 1000000000000000000, 100000000)
 *
 * Both calls said "one HBAR". One of them was wrong by ten billion.
 *
 * WHAT MAKES IT DANGEROUS is that it does not reproduce locally. A Hardhat
 * node is an ordinary EVM: `value` and `msg.value` are both wei, both 18dp,
 * and they agree. Every contract test passes. The failure appears only on
 * real Hedera, where the escrow silently under-counts by 10^10 and the policy
 * can never reach Active — with an error that names two numbers and does not
 * explain why they differ.
 * ---------------------------------------------------------------------------
 *
 * THE RULE
 *
 * - Anything going into a transaction's `value` field: `hbarToTxValue`.
 * - Anything the CONTRACT will compare against `msg.value`, or store as an
 *   amount: `hbarToContractAmount`, which needs the chain id.
 *
 * Never `parseEther` for the second one, and never assume they are the same
 * number.
 *
 * Framework-free. See invariants.ts.
 */

/** Hedera chain ids. 298 is the local single-node network. */
export const HEDERA_CHAIN_IDS = [295, 296, 297, 298] as const;

/** `value` on a transaction is always 18dp, on every chain this template targets. */
export const TX_VALUE_DECIMALS = 18;

/** What `msg.value` is denominated in, inside the EVM. */
export const MSG_VALUE_DECIMALS_HEDERA = 8;
export const MSG_VALUE_DECIMALS_EVM = 18;

export function isHederaChain(chainId: number): boolean {
  return (HEDERA_CHAIN_IDS as readonly number[]).includes(chainId);
}

/**
 * The decimals a contract on this chain will see in `msg.value`.
 *
 * A local Hardhat node is an ordinary EVM and uses 18, which is precisely why
 * this bug cannot be caught by the contract test suite.
 */
export function msgValueDecimals(chainId: number): number {
  return isHederaChain(chainId) ? MSG_VALUE_DECIMALS_HEDERA : MSG_VALUE_DECIMALS_EVM;
}

/** Parse a human amount at a given number of decimals. No library needed. */
function parseAtDecimals(hbar: string, decimals: number): bigint {
  const trimmed = hbar.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error(`"${hbar}" is not an amount`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    // Truncating here would silently lose money. At 8dp a caller asking for
    // 0.000000001 HBAR is asking for something the network cannot express.
    throw new Error(
      `${hbar} has ${fraction.length} decimal places; this chain resolves ${decimals}. ` +
        `The smallest expressible amount is ${1 / 10 ** decimals}.`,
    );
  }
  return BigInt((whole || "0") + fraction.padEnd(decimals, "0"));
}

/** For a transaction's `value` field. Always 18dp. */
export function hbarToTxValue(hbar: string): bigint {
  return parseAtDecimals(hbar, TX_VALUE_DECIMALS);
}

/**
 * For an amount the contract stores or compares against `msg.value`.
 *
 * This is the one that differs by chain, and the one that is wrong by ten
 * billion if you reach for parseEther instead.
 */
export function hbarToContractAmount(hbar: string, chainId: number): bigint {
  return parseAtDecimals(hbar, msgValueDecimals(chainId));
}

/** Render a contract-side amount back as HBAR. */
export function contractAmountToHbar(amount: bigint, chainId: number): string {
  return formatAtDecimals(amount, msgValueDecimals(chainId));
}

export function formatAtDecimals(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const unit = 10n ** BigInt(decimals);
  const whole = magnitude / unit;
  const fraction = (magnitude % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * The same human amount, in both units, for one transaction.
 *
 * Returning them together is deliberate: the two always travel as a pair, and
 * a call site that derives only one of them is a call site that got it wrong.
 */
export function hbarAmount(hbar: string, chainId: number): { txValue: bigint; contractAmount: bigint } {
  return { txValue: hbarToTxValue(hbar), contractAmount: hbarToContractAmount(hbar, chainId) };
}
