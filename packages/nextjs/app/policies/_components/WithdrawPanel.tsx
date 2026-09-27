"use client";

import { useEffect, useState } from "react";
import { TransactionStatus, useTransactionStatus } from "./TransactionStatus";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";
import { transactionProblem } from "~~/lib/settlement/transactionFeedback";
import { contractAmountToHbar } from "~~/lib/settlement/units";
import type { AllowedChainIds } from "~~/utils/scaffold-hbar";
import { getParsedErrorWithAllAbis } from "~~/utils/scaffold-hbar/contract";

/**
 * Surplus escrow waiting for the connected account.
 *
 * settle() credits anything funded beyond the payout to the creator instead
 * of sending it, so a creator that cannot receive HBAR cannot block the
 * beneficiary's payment. This is where that credit is claimed. Renders
 * nothing when there is nothing to claim.
 */
export const WithdrawPanel = () => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const transaction = useTransactionStatus("withdraw");
  const [problem, setProblem] = useState<string | null>(null);

  const { data: owed, refetch } = useScaffoldReadContract({
    contractName: "PolicyRegistry",
    functionName: "withdrawable",
    args: [address],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "PolicyRegistry" });

  useEffect(() => {
    if (transaction.receipt.data) void refetch();
  }, [transaction.receipt.data, refetch]);

  const amount = owed ?? 0n;
  if (!address || (amount === 0n && !transaction.hash)) return null;

  const withdraw = async () => {
    setProblem(null);
    try {
      await writeContractAsync({ functionName: "withdraw" }, { onSubmitted: transaction.onSubmitted });
    } catch (caught) {
      setProblem(transactionProblem(getParsedErrorWithAllAbis(caught, targetNetwork.id as AllowedChainIds)));
    } finally {
      await refetch();
    }
  };

  return (
    <section className="rounded-box border border-base-300 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          {amount > 0n ? (
            <>
              <span className="font-semibold">{contractAmountToHbar(amount, targetNetwork.id)} HBAR</span> of surplus
              escrow from your settled policies is ready to withdraw.
            </>
          ) : (
            "Nothing left to withdraw."
          )}
        </p>
        {amount > 0n && (
          <button
            className="btn btn-primary btn-sm"
            disabled={isMining || transaction.pending}
            onClick={() => void withdraw()}
          >
            {isMining && <span className="loading loading-spinner loading-xs" />}
            Withdraw
          </button>
        )}
      </div>
      <TransactionStatus status={transaction} />
      {problem && (
        <p role="alert" className="mt-3 text-sm text-error">
          {problem}
        </p>
      )}
    </section>
  );
};
