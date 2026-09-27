"use client";

import { useState } from "react";
import { PolicyCard } from "./PolicyCard";
import { PolicyForm } from "./PolicyForm";
import { HederaPortalFaucet } from "@scaffold-hbar-ui/components";
import { useAccount } from "wagmi";
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
 */
export const PolicyFlow = () => {
  const { isConnected } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: registry, isLoading: registryLoading } = useDeployedContractInfo({ contractName: "PolicyRegistry" });

  const { data: nextPolicyId, refetch: refetchPolicyCount } = useScaffoldReadContract({
    contractName: "PolicyRegistry",
    functionName: "nextPolicyId",
    // Re-read after a write rather than waiting for the poll interval.
    query: { refetchInterval: 8_000 },
  });

  if (registryLoading) {
    return <div className="skeleton h-40 w-full" />;
  }

  // Nothing deployed on this network. Say which network and what to run.
  if (!registry) {
    return (
      <div role="alert" className="alert alert-warning">
        <div>
          <p className="font-semibold">No PolicyRegistry deployed on the selected network.</p>
          <p className="mt-1 text-sm">
            Deploy with <span className="font-mono">yarn hardhat:deploy --network hederaTestnet</span>, or switch the
            network in the header to one where it is deployed.
          </p>
        </div>
      </div>
    );
  }

  const count = nextPolicyId ? Number(nextPolicyId) - 1 : 0;
  const ids = Array.from({ length: count }, (_, i) => count - i);

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
              Creating a policy is a transaction, so this step needs a wallet. Everything on{" "}
              <span className="font-mono text-xs">/feeds</span> and <span className="font-mono text-xs">/evidence</span>{" "}
              works without one.
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
      </section>
    </div>
  );
};
