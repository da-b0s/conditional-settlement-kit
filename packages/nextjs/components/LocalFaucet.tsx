"use client";

import { useState } from "react";
import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { useAccount, useBalance } from "wagmi";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";
import { notification } from "~~/utils/scaffold-hbar";

/**
 * Fund the connected account on the LOCAL chain only.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Without it, the most interesting part of this template is unreachable to
 * anyone who has not already obtained testnet HBAR. A reviewer can read
 * /feeds and /evidence with no credentials at all — that is the point of them
 * — but creating and settling a policy costs gas, and a burner wallet on a
 * fresh local chain has nothing. So the lifecycle that the six invariants are
 * about could only be demonstrated by someone who had already been to a
 * faucet and waited.
 *
 * With this, plus the mock feed the deploy script registers on a local chain,
 * the whole thing runs offline:
 *
 *     yarn chain          # terminal 1
 *     yarn deploy         # terminal 2
 *     yarn start          # terminal 3 — then switch the network to
 *                         # "Hedera Local Fork", connect a burner, click this
 * ---------------------------------------------------------------------------
 *
 * THE KEY BELOW IS NOT A SECRET
 *
 * It is Hardhat's first well-known development account, printed by
 * `hardhat node` on every start and published in Hardhat's own
 * documentation. Every Ethereum developer has it. It holds 10,000 test HBAR
 * on a chain that exists only on this machine and is destroyed when the node
 * stops.
 *
 * It is still gated to chainId 31337 and nothing renders anywhere else, for
 * one reason: an account whose key is public is an account anyone can drain,
 * so a component that could ever be pointed at a funded real account is a
 * component that will eventually be pointed at one.
 */
const HARDHAT_ACCOUNT_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Enough to create, fund and settle several policies without going back. */
const GRANT = "100";

export const LocalFaucet = () => {
  const { address, isConnected } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const [sending, setSending] = useState(false);

  const isLocal = targetNetwork.id === hardhat.id;
  const { refetch } = useBalance({ address, query: { enabled: isLocal && isConnected } });

  // Renders nowhere but a local chain. See the header comment.
  if (!isLocal || !isConnected || !address) return null;

  const send = async () => {
    setSending(true);
    try {
      const client = createWalletClient({
        account: privateKeyToAccount(HARDHAT_ACCOUNT_0),
        // The scaffold's local network reuses Hardhat's chain id but declares
        // 18-decimal HBAR, so the target network is used rather than viem's
        // stock `hardhat` — the two disagree about the native currency and
        // formatting follows whichever one the client was built with.
        chain: targetNetwork,
        transport: http(),
      });

      await client.sendTransaction({ to: address, value: parseEther(GRANT) });
      await refetch();
      notification.success(`Sent ${GRANT} local HBAR.`);
    } catch (error) {
      // Overwhelmingly this is "the local node is not running", and saying so
      // is more use than the RPC's own connection error.
      notification.error(
        <>
          <p className="mt-0 mb-1 font-bold">Could not reach the local chain</p>
          <p className="m-0 text-sm">
            Is <code className="bg-base-300 px-1">yarn chain</code> running? {String(error).slice(0, 120)}
          </p>
        </>,
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <button className="btn btn-secondary btn-sm gap-1" onClick={send} disabled={sending}>
      {sending ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        <BanknotesIcon className="h-4 w-4" aria-hidden="true" />
      )}
      <span>Fund locally</span>
    </button>
  );
};
