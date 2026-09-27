"use client";

import { useEffect, useState } from "react";
import { type Hash } from "viem";
import { useAccount, useWaitForTransactionReceipt } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";
import { getBlockExplorerTxLink } from "~~/utils/scaffold-hbar";

export function useTransactionStatus(scope: string) {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const key = `settlement-tx:${targetNetwork.id}:${address}:${scope}`;
  const [stored, setStored] = useState<{ key: string; hash: Hash }>();
  const [restoredKey, setRestoredKey] = useState("");
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved && /^0x[\da-f]{64}$/i.test(saved)) setStored({ key, hash: saved as Hash });
    } catch {
      /* Storage can be disabled; in-memory status still works. */
    }
    setRestoredKey(key);
  }, [key]);
  const hash = stored?.key === key ? stored.hash : undefined;
  const receipt = useWaitForTransactionReceipt({
    hash,
    chainId: targetNetwork.id,
    timeout: 90_000,
    query: { enabled: !!hash, retry: false },
  });
  const onSubmitted = (submitted: Hash) => {
    setStored({ key, hash: submitted });
    try {
      sessionStorage.setItem(key, submitted);
    } catch {
      /* See above. */
    }
  };
  /**
   * Forget the tracked transaction. Offered only once confirmation checking
   * has failed: a dropped transaction would otherwise keep every action for
   * this scope disabled until the tab is closed.
   */
  const dismiss = () => {
    setStored(undefined);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* See above. */
    }
  };
  return {
    hash,
    receipt,
    onSubmitted,
    dismiss,
    // Still blocks resubmission while confirmation is unknown; the user
    // releases it explicitly with dismiss() after checking HashScan.
    pending: restoredKey !== key || (!!hash && !receipt.data),
    explorer: hash ? getBlockExplorerTxLink(targetNetwork.id, hash) : "",
  };
}

export function TransactionStatus({ status }: { status: ReturnType<typeof useTransactionStatus> }) {
  if (!status.hash) return null;
  return (
    <div role="status" className="mt-3 rounded-box border border-base-300 p-3 text-sm">
      <p>
        {status.receipt.data
          ? status.receipt.data.status === "success"
            ? "Transaction confirmed. The policy list refreshes automatically."
            : "Transaction reverted. The requested change was not made."
          : status.receipt.isError
            ? "Confirmation could not be checked. Look the transaction up on HashScan before submitting again."
            : "Transaction submitted. Waiting for confirmation; do not submit it again."}
      </p>
      {status.explorer && (
        <a className="link text-primary" href={status.explorer} target="_blank" rel="noreferrer">
          View transaction on HashScan
        </a>
      )}
      {status.receipt.isError && (
        <>
          <button className="btn btn-outline btn-xs ml-3" onClick={() => void status.receipt.refetch()}>
            Check confirmation
          </button>
          <button className="btn btn-ghost btn-xs ml-2" onClick={status.dismiss}>
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
