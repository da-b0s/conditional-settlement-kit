import { PendingTransactionError, transactionProblem } from "./transactionFeedback";
import { describe, expect, it } from "vitest";

describe("transaction feedback", () => {
  it("preserves the submitted hash when confirmation is unavailable", () => {
    const hash = `0x${"a".repeat(64)}` as const;
    const error = new PendingTransactionError(hash);
    expect(error.hash).toBe(hash);
    expect(error.message).toContain("submitted");
    expect(error.message).toContain("before trying again");
  });

  // The decoded name must match ChainlinkPriceSource's declaration exactly.
  it.each(["ObservationStale(bytes32,uint256,uint256,uint64)", "reverted: 0xe2d96fb3"])(
    "explains stale feed errors, decoded or raw: %s",
    error => {
      expect(transactionProblem(error)).toContain("price feed is too old");
    },
  );

  it.each([
    ["ConditionNotMet(1, 5, 10, true)", "threshold"],
    ["AlreadyExpired(1, 100, 200)", "deadline has passed"],
    ["PayoutExceedsEscrow(1, 10, 5)", "does not cover the payout"],
    ["NotCreator()", "creator"],
    ["IllegalTransition(1, 4, 5)", "already moved on"],
    ["FundingNotAllowed(1, 4)", "no longer accepts deposits"],
    ["NoPriceSource(0x00)", "no price feed"],
  ])("explains %s", (error, expected) => {
    expect(transactionProblem(error)).toContain(expected);
  });

  it("does not discard unrecognized error details", () => {
    expect(transactionProblem("Failure\nSpecific reason")).toBe("Failure\nSpecific reason");
  });
});
