/** A submitted transaction is not a failed transaction when receipt polling fails. */
export class PendingTransactionError extends Error {
  constructor(public readonly hash: `0x${string}`) {
    super("Transaction submitted, but confirmation is delayed. Check its status before trying again.");
    this.name = "PendingTransactionError";
  }
}

/**
 * Contract reverts, by custom error name, in words a user can act on.
 *
 * Errors normally arrive decoded by name (the ABIs are known), so the names
 * must match the Solidity declarations exactly. `0xe2d96fb3` is the selector
 * of ObservationStale(bytes32,uint256,uint256,uint64), kept for the case where
 * decoding fails and only the raw selector survives.
 */
const CONTRACT_ERRORS: readonly [RegExp, string][] = [
  [
    /ObservationStale|0xe2d96fb3/i,
    "The price feed is too old for this policy. Wait for a fresh reading; the escrow remains held.",
  ],
  [/ConditionNotMet/i, "The latest price has not reached this policy's threshold."],
  [/IncompleteRound|NegativePrice/i, "The price feed returned an unusable reading. Try again after its next update."],
  [/NoPriceSource|FeedNotRegistered/i, "This policy's asset has no price feed configured on this deployment."],
  [/AlreadyExpired/i, "This policy's deadline has passed. It can only be expired and refunded now."],
  [/NotYetExpired/i, "This policy's deadline has not passed yet, so it cannot be expired."],
  [
    /PayoutExceedsEscrow/i,
    "The deposit does not cover the payout. The first deposit must be at least the full payout.",
  ],
  [/FundingNotAllowed/i, "This policy no longer accepts deposits."],
  [/NothingToWithdraw/i, "There is nothing to withdraw for this account."],
  [/NothingToFund/i, "Enter an amount above zero to fund this policy."],
  [/NotCreator/i, "Only the policy's creator can take the refund."],
  [/IllegalTransition/i, "This policy has already moved on. Refresh to see its current state."],
  [/ExpiryInPast/i, "The deadline is in the past. A policy cannot be created already expired."],
  [/TransferFailed/i, "The network could not deliver the HBAR to the recipient account. Nothing was paid."],
  [/UnknownPolicy/i, "That policy does not exist on this deployment."],
];

export function transactionProblem(message: string): string {
  for (const [pattern, explanation] of CONTRACT_ERRORS) {
    if (pattern.test(message)) return explanation;
  }
  if (/User rejected|User denied|rejected the request/i.test(message)) return "Request cancelled in your wallet.";
  if (/not support|not supported|method not found/i.test(message)) {
    return "Your wallet connection rejected a requested method. Check the wallet's transaction history before retrying, then reconnect HashPack on Hedera Testnet if needed.";
  }
  return message;
}
