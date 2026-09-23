/**
 * The ten-billion gap, pinned.
 *
 * This is the one bug in the repository that a passing contract suite cannot
 * catch, because a Hardhat node is an ordinary EVM where the two units agree.
 * It cost a reverted testnet transaction to find. These tests are the reason
 * it cannot cost that twice.
 */
import {
  MSG_VALUE_DECIMALS_EVM,
  MSG_VALUE_DECIMALS_HEDERA,
  contractAmountToHbar,
  hbarAmount,
  hbarToContractAmount,
  hbarToTxValue,
  isHederaChain,
  msgValueDecimals,
} from "./units";
import { describe, expect, it } from "vitest";

const TESTNET = 296;
const LOCAL = 31337;

describe("THE GAP: one HBAR is two different numbers", () => {
  it("is 1e18 in a transaction's value field", () => {
    expect(hbarToTxValue("1")).toBe(10n ** 18n);
  });

  it("is 1e8 in msg.value on Hedera", () => {
    expect(hbarToContractAmount("1", TESTNET)).toBe(10n ** 8n);
  });

  it("and they differ by exactly ten billion", () => {
    expect(hbarToTxValue("1") / hbarToContractAmount("1", TESTNET)).toBe(10n ** 10n);
  });

  it("THE REGRESSION: the pair that caused PayoutExceedsEscrow", () => {
    // createPolicy got 1e18 while fund's msg.value arrived as 1e8, so the
    // registry compared maxPayout 1000000000000000000 against escrow
    // 100000000 and refused to activate a fully funded policy.
    const { txValue, contractAmount } = hbarAmount("1", TESTNET);
    expect(txValue).toBe(1_000_000_000_000_000_000n);
    expect(contractAmount).toBe(100_000_000n);
    expect(contractAmount).not.toBe(txValue);
  });

  it("agrees on a local EVM, which is exactly why tests missed it", () => {
    // A Hardhat node is an ordinary EVM: value and msg.value are both wei.
    // Everything passes locally and fails only on real Hedera.
    expect(hbarToContractAmount("1", LOCAL)).toBe(hbarToTxValue("1"));
  });
});

describe("which chains are Hedera", () => {
  it.each([295, 296, 297, 298])("%i is", id => {
    expect(isHederaChain(id)).toBe(true);
    expect(msgValueDecimals(id)).toBe(MSG_VALUE_DECIMALS_HEDERA);
  });

  it.each([1, 31337, 11155111])("%i is not", id => {
    expect(isHederaChain(id)).toBe(false);
    expect(msgValueDecimals(id)).toBe(MSG_VALUE_DECIMALS_EVM);
  });
});

describe("parsing", () => {
  it("handles fractional amounts at both precisions", () => {
    expect(hbarToContractAmount("0.5", TESTNET)).toBe(50_000_000n);
    expect(hbarToTxValue("0.5")).toBe(500_000_000_000_000_000n);
    expect(hbarToContractAmount("0.00000001", TESTNET)).toBe(1n);
  });

  it("REFUSES to truncate below what the chain can express", () => {
    // Silently rounding to zero is how a payout becomes nothing. Hedera
    // resolves 8 decimals; a ninth is not a small error, it is a lost amount.
    expect(() => hbarToContractAmount("0.000000001", TESTNET)).toThrow(/9 decimal places.*resolves 8/s);
  });

  it("allows 18 places where the chain actually has them", () => {
    expect(() => hbarToTxValue("0.000000000000000001")).not.toThrow();
  });

  it("rejects things that are not amounts", () => {
    for (const bad of ["", ".", "abc", "1.2.3", "-1", "1e18"]) {
      expect(() => hbarToTxValue(bad), bad).toThrow(/is not an amount/);
    }
  });

  it("round-trips", () => {
    for (const amount of ["1", "0.5", "123.456", "0.00000001"]) {
      expect(contractAmountToHbar(hbarToContractAmount(amount, TESTNET), TESTNET)).toBe(amount);
    }
  });

  it("renders a whole number without a trailing dot", () => {
    expect(contractAmountToHbar(100_000_000n, TESTNET)).toBe("1");
  });
});
