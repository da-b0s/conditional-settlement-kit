"use client";

import { useState } from "react";
import { PolicyCard } from "./PolicyCard";
import { PolicyForm } from "./PolicyForm";
import { WithdrawPanel } from "./WithdrawPanel";
import { HederaPortalFaucet } from "@scaffold-hbar-ui/components";
import { useAccount } from "wagmi";
import { TalonMark } from "~~/components/TalonMark";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";

/**
 * The wallet-driven half of the kit.
 *
 * Policy ids are sequential from 1, and `nextPolicyId` is public, so the
 * list is derived by counting rather than by indexing events. That matters
 * on Hedera: mirror-node log queries lag, and a policy created ten seconds
 * ago would be missing from an event-derived list while being perfectly
 * readable by id.
 *
 * Only the newest PAGE_SIZE are rendered at first. Every card polls its own
 * policy and price, so rendering every policy ever created would multiply
 * requests to the public RPC until it rate-limits the page.
 */
const PAGE_SIZE = 10;

export const PolicyFlow = () => {
  const { isConnected } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const [refreshKey, setRefreshKey] = useState(0);
  const [shown, setShown] = useState(PAGE_SIZE);

  const { data: registry, isLoading: registryLoading } = useDeployedContractInfo({ contractName: "PolicyRegistry" });

  const { data: nextPolicyId, refetch: refetchPolicyCount } = useScaffoldReadContract({
    contractName: "PolicyRegistry",
    functionName: "nextPolicyId",
    // Re-read after a write rather than waiting for the poll interval.
    query: { refetchInterval: 8_000 },
  });

  if (registryLoading) {
    return (
      <div className="flex items-center gap-3 rounded-box border border-base-300 p-6" role="status">
        <TalonMark animated className="h-8 w-8 text-base-content" />
        <span className="text-sm text-base-content/70">Finding the contracts on Hedera testnet…</span>
      </div>
    );
  }

  // Nothing deployed on this network. Say which network and what to run.
  if (!registry) {
    return (
      <div role="alert" className="alert alert-warning">
        <div>
          <p className="font-semibold">No PolicyRegistry is deployed on {targetNetwork.name}.</p>
          <p className="mt-1 text-sm">
            Deploy with <span className="font-mono">yarn hardhat:deploy</span>, which targets Hedera testnet.
          </p>
        </div>
      </div>
    );
  }

  const count = nextPolicyId ? Number(nextPolicyId) - 1 : 0;
  const ids = Array.from({ length: Math.min(count, shown) }, (_, i) => count - i);
  const hidden = count - ids.length;

  return (
    <div className="space-y-10">
      <div className="rounded-box border border-base-300 p-4">
        <p className="font-semibold">{targetNetwork.name}</p>
        <p className="text-sm">
          These are real testnet transactions using test HBAR. Your wallet approves each transaction. Fund your wallet
          first, then fund a policy&apos;s escrow once.
        </p>
        <HederaPortalFaucet showIcon />
      </div>
      <WithdrawPanel />
      <section>
        <h2 className="mb-3 text-xl font-semibold">Create a policy</h2>
        {isConnected ? (
          <PolicyForm
            onCreated={() => {
              void refetchPolicyCount();
              setRefreshKey(k => k + 1);
            }}
          />
        ) : (
          <div className="rounded-box border border-base-300 p-6">
            <p className="text-base-content/70">
              Connect a wallet to create a policy. Live prices and Evidence work without one.
            </p>
            <div className="mt-4">
              <RainbowKitCustomConnectButton />
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">
            {count === 0 ? "No policies yet" : `${count} polic${count === 1 ? "y" : "ies"}`}
          </h2>
          {count > 0 && <span className="text-xs text-base-content/50">newest first</span>}
        </div>

        {count === 0 ? (
          <p className="rounded-box border border-base-300 p-6 text-base-content/60">
            Policies created against this registry will appear here, whoever created them. The list is public because
            the registry is.
          </p>
        ) : (
          <ul className="space-y-4">
            {ids.map(id => (
              <li key={`${id}-${refreshKey}`}>
                <PolicyCard policyId={BigInt(id)} />
              </li>
            ))}
          </ul>
        )}

        {hidden > 0 && (
          <div className="mt-4 flex items-center gap-3">
            <button className="btn btn-outline btn-sm" onClick={() => setShown(n => n + PAGE_SIZE)}>
              Show {Math.min(hidden, PAGE_SIZE)} older
            </button>
            <span className="text-xs text-base-content/60">
              Showing {ids.length} of {count}
            </span>
          </div>
        )}
      </section>
    </div>
  );
};
