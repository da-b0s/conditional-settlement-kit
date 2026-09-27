import { ethers } from "hardhat";
import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * Deploy the settlement system and wire it.
 *
 * ---------------------------------------------------------------------------
 * ORDER MATTERS, AND SO DOES THE WIRING
 *
 *   1. ChainlinkPriceSource, then register each feed WITH ITS OWN BOUND.
 *   2. PolicyRegistry, which holds the escrow.
 *   3. Settlement, which is told about the registry.
 *   4. registry.setSettlement(settlement) — until this runs, nothing can pay.
 *   5. settlement.setPriceSource(asset, source) per asset.
 *
 * Step 4 is the one to notice. The registry refuses `settle` from anyone but
 * the settlement contract, so a deployment that stops at step 3 produces a
 * system where policies can be funded and never paid. The verification block
 * at the end checks it rather than assuming it.
 * ---------------------------------------------------------------------------
 *
 * The feed table below mirrors lib/settlement/feeds.ts. It is duplicated
 * rather than imported because Hardhat scripts and the Next app do not share
 * a module graph — and a mismatch between them would mean the UI states a
 * bound the chain does not enforce. test/I7_deploy_table_parity.t.ts imports
 * both and fails if they ever drift apart.
 */

const HOUR = 3_600;
const DAY = 86_400;

/** Hedera testnet Chainlink proxies, with the per-feed bound each one needs. */
export const FEEDS: { pair: string; proxy: string; maxAge: number }[] = [
  // Fast movers. A reading older than an hour here is a hundred updates behind.
  { pair: "HBAR/USD", proxy: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a", maxAge: 1 * HOUR },
  { pair: "LINK/USD", proxy: "0xF111b70231E89D69eBC9f6C9208e9890383Ef432", maxAge: 2 * HOUR },
  { pair: "BTC/USD", proxy: "0x058fE79CB5775d4b167920Ca6036B824805A9ABd", maxAge: 6 * HOUR },
  { pair: "ETH/USD", proxy: "0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9", maxAge: 3 * HOUR },
  // Stablecoins update rarely by nature. Anything tighter than the declared
  // heartbeat rejects a perfectly healthy feed — measured at 16 to 23 hours.
  { pair: "USDC/USD", proxy: "0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5", maxAge: DAY },
  { pair: "USDT/USD", proxy: "0x06823de8E77d708C4cB72Cbf04495D67afF4Bd37", maxAge: DAY },
  { pair: "DAI/USD", proxy: "0xdA2aBF7C90aDC73CDF5cA8d720B87bD5F5863389", maxAge: DAY },
];

export const assetKey = (pair: string) => ethers.keccak256(ethers.toUtf8Bytes(pair));

const deploySettlement: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, log } = hre.deployments;

  // Hedera testnet only. The Chainlink proxies below exist nowhere else, and
  // registering one on another chain reverts on its decimals() call.
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  if (chainId !== 296) {
    throw new Error(`This template deploys to Hedera testnet (chain 296), not chain ${chainId}.`);
  }

  const source = await deploy("ChainlinkPriceSource", { from: deployer, log: true, autoMine: true });
  const registry = await deploy("PolicyRegistry", { from: deployer, log: true, autoMine: true });
  const settlement = await deploy("Settlement", {
    from: deployer,
    args: [registry.address],
    log: true,
    autoMine: true,
  });

  const sourceC = await hre.ethers.getContractAt("ChainlinkPriceSource", source.address);
  const registryC = await hre.ethers.getContractAt("PolicyRegistry", registry.address);
  const settlementC = await hre.ethers.getContractAt("Settlement", settlement.address);

  for (const feed of FEEDS) {
    const asset = assetKey(feed.pair);
    try {
      const tx = await sourceC.registerFeed(asset, feed.proxy, feed.maxAge);
      await tx.wait();
      log(`  registered ${feed.pair.padEnd(9)} maxAge ${String(feed.maxAge).padStart(6)}s  ${feed.proxy}`);
    } catch (error) {
      // One bad feed must not abort the rest. Report and continue.
      log(`  FAILED ${feed.pair}: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  // Step 4. Without this the registry refuses every settle().
  const currentSettlement = await registryC.settlement();
  if (currentSettlement.toLowerCase() !== settlement.address.toLowerCase()) {
    await (await registryC.setSettlement(settlement.address)).wait();
    log(`  registry.settlement -> ${settlement.address}`);
  }

  // Point every asset the source actually registered at it. A feed that
  // failed to register above is skipped rather than wired to nothing.
  for (const feed of FEEDS) {
    const asset = assetKey(feed.pair);
    if (!(await sourceC.supportsAsset(asset))) continue;
    if ((await settlementC.priceSourceOf(asset)).toLowerCase() === source.address.toLowerCase()) continue;
    await (await settlementC.setPriceSource(asset, source.address)).wait();
    log(`  priceSource[${feed.pair}] -> ${source.address}`);
  }

  // Verify the wiring rather than trust it. A system that deploys cleanly and
  // cannot pay is worse than one that fails loudly here.
  const wired = await registryC.settlement();
  if (wired.toLowerCase() !== settlement.address.toLowerCase()) {
    throw new Error(`registry.settlement is ${wired}, expected ${settlement.address}`);
  }
  log("  wiring verified: the registry will accept settlement from this Settlement contract");
};

export default deploySettlement;
deploySettlement.tags = ["Settlement", "PolicyRegistry", "ChainlinkPriceSource"];
