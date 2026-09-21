/**
 * Shared fixture for the invariant suites.
 *
 * One deployment path, used by all six files, so a test that passes cannot be
 * passing because it wired the system differently from the others.
 */
import { ethers } from "hardhat";
import type { ChainlinkPriceSource, MockAggregatorV3, PolicyRegistry, Settlement } from "../typechain-types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/** keccak256("HBAR/USD") — the canonical demo asset. */
export const HBAR_USD = ethers.keccak256(ethers.toUtf8Bytes("HBAR/USD"));
export const DAI_USD = ethers.keccak256(ethers.toUtf8Bytes("DAI/USD"));

export const HOUR = 3600;
export const DAY = 86_400;

/** Chainlink reports 8 decimals; the system composes at 18. */
export const FEED_DECIMALS = 8;

/** A price expressed at feed precision (8dp). */
export function atFeedDecimals(human: string): bigint {
  return ethers.parseUnits(human, FEED_DECIMALS);
}

/** The same price as the system will see it, normalised to 18dp. */
export function at18(human: string): bigint {
  return ethers.parseUnits(human, 18);
}

export interface Deployed {
  registry: PolicyRegistry;
  settlement: Settlement;
  source: ChainlinkPriceSource;
  aggregator: MockAggregatorV3;
  owner: HardhatEthersSigner;
  creator: HardhatEthersSigner;
  beneficiary: HardhatEthersSigner;
  stranger: HardhatEthersSigner;
}

/**
 * Deploy the whole system, wired as production wires it.
 *
 * @param priceHuman  Starting price, e.g. "0.0891" for HBAR/USD.
 * @param maxAge      The per-feed staleness bound. One hour by default,
 *                    matching the recommended bound for HBAR/USD.
 */
export async function deploySystem(priceHuman = "0.0891", maxAge = HOUR): Promise<Deployed> {
  const [owner, creator, beneficiary, stranger] = await ethers.getSigners();

  const agg = await ethers.deployContract("MockAggregatorV3", [
    FEED_DECIMALS,
    atFeedDecimals(priceHuman),
    Math.floor(Date.now() / 1000),
  ]);
  await agg.waitForDeployment();
  // Anchor the reading to the chain clock, not to wall time — Hardhat's
  // block timestamp drifts from Date.now() as tests advance time.
  await agg.setAgeSeconds(0);

  const source = await ethers.deployContract("ChainlinkPriceSource");
  await source.waitForDeployment();
  await source.registerFeed(HBAR_USD, await agg.getAddress(), maxAge);

  const registry = await ethers.deployContract("PolicyRegistry");
  await registry.waitForDeployment();

  const settlement = await ethers.deployContract("Settlement", [await registry.getAddress()]);
  await settlement.waitForDeployment();

  await registry.setSettlement(await settlement.getAddress());
  await settlement.setPriceSource(HBAR_USD, await source.getAddress());

  return {
    registry: registry as unknown as PolicyRegistry,
    settlement: settlement as unknown as Settlement,
    source: source as unknown as ChainlinkPriceSource,
    aggregator: agg as unknown as MockAggregatorV3,
    owner,
    creator,
    beneficiary,
    stranger,
  };
}

/** Seconds since the epoch according to the CHAIN, which is what expiry uses. */
export async function chainNow(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("no latest block");
  return block.timestamp;
}

/** Create and fund a policy, returning its id. */
export async function createFundedPolicy(
  d: Deployed,
  opts: {
    thresholdHuman?: string;
    triggerAbove?: boolean;
    payout?: bigint;
    escrow?: bigint;
    expiryInSeconds?: number;
  } = {},
): Promise<bigint> {
  const threshold = at18(opts.thresholdHuman ?? "0.0800");
  const triggerAbove = opts.triggerAbove ?? true;
  const payout = opts.payout ?? ethers.parseEther("1");
  const escrow = opts.escrow ?? ethers.parseEther("1");
  const expiry = (await chainNow()) + (opts.expiryInSeconds ?? DAY);

  const tx = await d.registry
    .connect(d.creator)
    .createPolicy(d.beneficiary.address, HBAR_USD, threshold, triggerAbove, payout, expiry);
  const receipt = await tx.wait();

  const created = receipt!.logs
    .map(l => {
      try {
        return d.registry.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find(p => p?.name === "PolicyCreated");
  if (!created) throw new Error("PolicyCreated not emitted");
  const policyId = created.args[0] as bigint;

  await d.registry.connect(d.creator).fund(policyId, { value: escrow });
  return policyId;
}

/** Move the chain clock forward and mine, so expiry tests are deterministic. */
export async function advance(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

export const State = {
  None: 0n,
  Draft: 1n,
  Active: 2n,
  Triggered: 3n,
  Settled: 4n,
  Expired: 5n,
  Refunded: 6n,
} as const;
