"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";
import { useAllContracts } from "~~/utils/scaffold-hbar/contractsData";
import { getExplorerLink } from "~~/utils/scaffold-hbar/networks";

/**
 * Hedera is indexed by its mirror node, and HashScan is the explorer over it.
 * This page does not try to replace it: it points at this project's own
 * artefacts there, so every link is a fact a reader can check.
 */
const BlockExplorer: NextPage = () => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const allContracts = useAllContracts();
  const explorerBase = targetNetwork.blockExplorers?.default?.url ?? "https://hashscan.io/testnet";

  return (
    <div className="container mx-auto my-10">
      <div className="flex justify-center p-8">
        <div className="max-w-xl text-center text-base-content/80">
          <h1 className="text-2xl font-bold">Explore {targetNetwork.name}</h1>
          <p>View confirmed transactions, account activity and deployed contracts on HashScan.</p>
          <a
            className="btn btn-primary"
            href={getExplorerLink(targetNetwork, address)}
            target="_blank"
            rel="noreferrer"
          >
            {address ? "View wallet transactions" : "Open HashScan"}
          </a>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5">
        <h2 className="text-lg font-bold mb-1">This project, on HashScan</h2>
        <p className="text-sm opacity-70 mb-4">
          Everything this template has put on testnet. Verifiable without running anything.
        </p>

        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold mb-1.5">Contracts</h3>
            <ul className="text-sm flex flex-col gap-1 m-0 pl-0 list-none">
              {Object.entries(allContracts).map(([name, contract]) => (
                <li key={name} className="flex flex-wrap items-baseline gap-2">
                  <a
                    className="link link-hover font-mono text-primary"
                    href={`${explorerBase}/contract/${contract.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {name}
                  </a>
                  <span className="font-mono text-xs opacity-60">{contract.address}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1.5">The evidence trail</h3>
            <p className="text-xs opacity-60 mb-2">
              Evidence is published separately by an operator to a public testnet topic. Read published records without
              connecting a wallet; they are not an automatic log of every transaction.
            </p>
            <Link href="/evidence" className="link link-hover text-sm text-primary">
              Open the evidence reader →
            </Link>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1.5">Live prices</h3>
            <p className="text-xs opacity-60 mb-2">
              The seven Chainlink feeds this kit can settle against, read from the chain on load, with the age each is
              reporting against the bound enforced for it.
            </p>
            <Link href="/feeds" className="link link-hover text-sm text-primary">
              See live prices →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlockExplorer;
