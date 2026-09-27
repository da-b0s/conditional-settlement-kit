"use client";

import { useEffect, useState } from "react";
import { TransactionStatus, useTransactionStatus } from "./TransactionStatus";
import { Address, HbarInput } from "@scaffold-hbar-ui/components";
import { formatUnits, keccak256, toHex } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";
import { TESTNET_FEEDS } from "~~/lib/settlement/feeds";
import { transactionProblem } from "~~/lib/settlement/transactionFeedback";
import { contractAmountToHbar, hbarToTxValue } from "~~/lib/settlement/units";
import type { AllowedChainIds } from "~~/utils/scaffold-hbar";
import { getParsedErrorWithAllAbis } from "~~/utils/scaffold-hbar/contract";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar/networks";

/** Mirrors PolicyRegistry.State. Index is the on-chain enum value. */
const STATES = ["None", "Draft", "Active", "Triggered", "Settled", "Expired", "Refunded"] as const;

const BADGE: Record<string, string> = {
  Draft: "badge-ghost",
  Active: "badge-info",
  Triggered: "badge-warning",
  Settled: "badge-success",
  Expired: "badge-neutral",
  Refunded: "badge-neutral",
};

/** Reverse the keccak of the pair name, so a hash can be shown as "HBAR/USD". */
const PAIR_BY_HASH = new Map(TESTNET_FEEDS.map(f => [keccak256(toHex(f.pair)).toLowerCase(), f.pair]));

export const PolicyCard = ({ policyId }: { policyId: bigint }) => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const [fundAmount, setFundAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const transaction = useTransactionStatus(`policy:${policyId}`);

  const {
    data: policy,
    refetch,
    error: policyError,
  } = useScaffoldReadContract({
    contractName: "PolicyRegistry",
    functionName: "getPolicy",
    args: [policyId],
    query: { refetchInterval: 10_000 },
  });

  const preview = useScaffoldReadContract({
    contractName: "Settlement",
    functionName: "preview",
    args: [policyId],
    watch: false,
    query: {
      enabled: Number(policy?.state) === 2 && Number(policy?.expiry) * 1000 > now,
      refetchInterval: 15_000,
      retry: false,
    },
  });

  const { writeContractAsync: writeRegistry, isMining: registryMining } = useScaffoldWriteContract({
    contractName: "PolicyRegistry",
  });
  const { writeContractAsync: writeSettlement, isMining: settlementMining } = useScaffoldWriteContract({
    contractName: "Settlement",
  });

  useEffect(() => {
    // Policy data can stay unchanged while its deadline passes.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (transaction.receipt.data) {
      setProblem(null);
      void refetch();
    }
  }, [transaction.receipt.data, refetch]);

  if (!policy)
    return policyError ? (
      <div role="alert" className="alert">
        Could not load policy #{policyId.toString()}.{" "}
        <button className="btn btn-sm" onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    ) : (
      <div className="skeleton h-32 w-full" />
    );

  // getPolicy returns a struct that abitype widens to `any` for these fields,
  // so `maxPayout - escrow` would come back a NUMBER and quietly lose
  // precision on any value past 2^53 weibar — about 0.009 HBAR. Pin the two
  // the component does arithmetic on.
  const maxPayout = BigInt(policy.maxPayout);
  const escrow = BigInt(policy.escrow);

  const state = STATES[Number(policy.state)] ?? "Unknown";
  const pair = PAIR_BY_HASH.get(policy.asset.toLowerCase());
  const isCreator = address?.toLowerCase() === policy.creator.toLowerCase();
  const deadline = new Date(Number(policy.expiry) * 1000);
  const pastDeadline = deadline.getTime() <= now;
  const busy = registryMining || settlementMining || transaction.pending || !address;
  const ready = !preview.error && !!preview.data?.[2];
  const previewProblem = preview.error
    ? transactionProblem(getParsedErrorWithAllAbis(preview.error, targetNetwork.id as AllowedChainIds))
    : null;

  const run = async (fn: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await fn();
    } catch (caught) {
      setProblem(transactionProblem(getParsedErrorWithAllAbis(caught, targetNetwork.id as AllowedChainIds)));
    } finally {
      // Refetch whether it succeeded or not: a revert still means the local
      // view may be stale relative to why it reverted.
      await refetch();
    }
  };

  return (
    <article className="rounded-box border border-base-300 p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm text-base-content/50">#{policyId.toString()}</span>
          <span className={`badge ${BADGE[state] ?? "badge-ghost"}`}>{state}</span>
        </div>
        <span className="text-xs text-base-content/50">
          {pastDeadline ? "deadline passed " : "expires "}
          {deadline.toLocaleString()}
        </span>
      </header>

      <p className="mt-3">
        Pays <span className="font-semibold">{contractAmountToHbar(maxPayout, targetNetwork.id)} HBAR</span> when{" "}
        <span className="font-semibold">{pair ?? "an asset"}</span> is{" "}
        {policy.triggerAbove ? "at or above" : "at or below"}{" "}
        <span className="font-semibold">{formatUnits(policy.threshold, 18)}</span>.
      </p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-base-content/60">beneficiary</dt>
        <dd>
          <Address
            address={policy.beneficiary}
            size="xs"
            chain={targetNetwork}
            style={{ color: "var(--color-base-content)" }}
            blockExplorerAddressLink={getBlockExplorerAddressLink(targetNetwork, policy.beneficiary)}
          />
        </dd>
        <dt className="text-base-content/60">escrow held</dt>
        <dd className="font-mono">{contractAmountToHbar(escrow, targetNetwork.id)} HBAR</dd>
        {!pair && (
          <>
            <dt className="text-base-content/60">asset hash</dt>
            <dd className="truncate font-mono text-xs">{policy.asset}</dd>
          </>
        )}
        {BigInt(policy.triggeredAt) > 0n && (
          <>
            <dt className="text-base-content/60">settled on</dt>
            <dd className="font-mono">
              {formatUnits(policy.triggerPrice, 18)} observed{" "}
              {new Date(Number(policy.triggeredAt) * 1000).toLocaleString()}
            </dd>
          </>
        )}
      </dl>

      {/* Only the actions the state machine actually permits are rendered.
          Showing a disabled Settle button on a refunded policy invites the
          question "why can't I", which the state already answers. */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {state === "Draft" && !pastDeadline && (
          <div className="flex items-end gap-2">
            <label className="form-control">
              <span className="label-text mb-1 text-xs">Fund escrow</span>
              <HbarInput placeholder="0.0" onValueChange={({ valueInNative }) => setFundAmount(valueInNative)} />
            </label>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy || !fundAmount || Number(fundAmount) <= 0}
              onClick={() =>
                run(() =>
                  writeRegistry(
                    {
                      functionName: "fund",
                      args: [policyId],
                      // A transaction's value field is ALWAYS 18dp, even on
                      // Hedera where the contract will read it as 8dp. This is
                      // the other half of the pair — the amount above is
                      // converted with contractAmountToHbar. See units.ts.
                      value: hbarToTxValue(fundAmount),
                    },
                    { onSubmitted: transaction.onSubmitted },
                  ),
                )
              }
            >
              Fund
            </button>
          </div>
        )}

        {state === "Active" && !pastDeadline && (
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy || !ready || preview.isFetching}
            onClick={() =>
              run(() =>
                writeSettlement(
                  {
                    functionName: "trigger",
                    args: [policyId],
                    ...(targetNetwork.id === 296 ? { gas: 3_000_000n } : {}),
                  },
                  { onSubmitted: transaction.onSubmitted },
                ),
              )
            }
          >
            Settle now
          </button>
        )}

        {(state === "Draft" || state === "Active") && pastDeadline && (
          <button
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() =>
              run(() =>
                writeRegistry({ functionName: "expire", args: [policyId] }, { onSubmitted: transaction.onSubmitted }),
              )
            }
          >
            Expire
          </button>
        )}

        {state === "Expired" && isCreator && (
          <button
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() =>
              run(() =>
                writeRegistry({ functionName: "refund", args: [policyId] }, { onSubmitted: transaction.onSubmitted }),
              )
            }
          >
            Take refund
          </button>
        )}

        {state === "Expired" && !isCreator && (
          <p className="text-sm text-base-content/60">Expired. Only the creator can take the refund.</p>
        )}
      </div>

      <TransactionStatus status={transaction} />
      {state === "Active" && <p className="mt-3 text-sm text-success">Fully funded. No further deposit is needed.</p>}
      {state === "Active" && escrow > maxPayout && (
        <p className="text-sm">
          The extra {contractAmountToHbar(escrow - maxPayout, targetNetwork.id)} HBAR is credited to the creator when
          this policy settles, and claimed with Withdraw at the top of this page. If it expires, the creator can reclaim
          the full escrow.
        </p>
      )}
      {state === "Active" && !pastDeadline && (
        <div className="mt-3 text-sm">
          <p>
            {previewProblem ??
              (preview.data
                ? ready
                  ? `Ready to settle at $${formatUnits(preview.data[0], 18)}.`
                  : `Waiting for the threshold. Latest price: $${formatUnits(preview.data[0], 18)}.`
                : "Checking the price feed...")}
          </p>
          <button className="btn btn-ghost btn-xs" disabled={preview.isFetching} onClick={() => void preview.refetch()}>
            Refresh price check
          </button>
        </div>
      )}

      {problem && (
        <p role="alert" className="mt-3 text-sm text-error">
          {problem}
        </p>
      )}

      {state === "Draft" && !pastDeadline && escrow < maxPayout && (
        <p className="mt-3 text-sm text-warning">
          Needs {contractAmountToHbar(maxPayout - escrow, targetNetwork.id)} HBAR more before it can activate. The
          contract will not let a policy promise more than it holds.
        </p>
      )}

      {state === "Active" && !pastDeadline && (
        <p className="mt-3 text-xs text-base-content/60">
          Anyone can press Settle — it succeeds only if the feed says the condition holds and the reading is inside this
          feed&apos;s freshness bound. Otherwise it reverts and nothing changes.
        </p>
      )}
    </article>
  );
};
