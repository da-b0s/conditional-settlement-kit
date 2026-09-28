import { optInBurnerWallet } from "./burnerOptIn";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import * as chains from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";

const wallets = [metaMaskWallet, walletConnectWallet];

const DEV_CHAIN_IDS = new Set<number>([chains.hardhat.id, chains.foundry.id, chains.hederaTestnet.id]);

const hasDevNetwork = scaffoldConfig.targetNetworks.some(n => DEV_CHAIN_IDS.has(n.id));

export const wagmiConnectors = () => {
  if (typeof window === "undefined") {
    return [];
  }

  const walletGroups = [
    {
      groupName: "Supported Wallets",
      wallets,
    },
  ];

  if (scaffoldConfig.enableBurnerWallet && hasDevNetwork) {
    walletGroups.push({
      groupName: "Development",
      // Opt-in wrapped: the stock burner reports itself authorized on every
      // load, so it connects itself to first-time visitors and re-connects
      // straight after an explicit Disconnect. See burnerOptIn.ts.
      wallets: [optInBurnerWallet],
    });
  }

  return connectorsForWallets(walletGroups, {
    appName: "Talon",
    projectId: scaffoldConfig.walletConnectProjectId,
  });
};
