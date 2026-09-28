import * as dotenv from "dotenv";
dotenv.config();

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
// Only load the Hedera forking plugin when starting the local node (yarn hardhat:chain / yarn hardhat:fork).
// Deploying to an already-running node doesn't need it and would fail with EADDRINUSE.
const forkingEnabled = process.env.HEDERA_FORKING === "true";
if (forkingEnabled) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional plugin load
  require("@hashgraph/system-contracts-forking/plugin");
}
import "hardhat-deploy";
import "hardhat-deploy-ethers";

import generateTsAbis from "./scripts/generateTsAbis";

// Hedera testnet JSON-RPC relay. HEDERA_RPC_URL in .env overrides it for every
// testnet task, not only forking.
const hederaRpcUrl = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";

// Deployer key: run `yarn account:generate` or `yarn account:import`, or set __RUNTIME_DEPLOYER_PRIVATE_KEY at runtime.
const deployerPrivateKey =
  process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    // Forking is OPT-IN, gated on the same flag that loads the plugin above.
    //
    // The scaffold ships this block unconditional, and it costs more than it
    // looks: with forking on, every deploy and every call in the test suite
    // round-trips to Hashio to fetch state. The invariant suite measured
    // 10 minutes that way and 12 seconds without it, and it fetches nothing
    // it needs — the price feed under test is MockAggregatorV3, deployed
    // locally, precisely so a bound can be tested at an age no live feed
    // would ever show.
    //
    // Leaving it on would also make the suite fail whenever Hashio is rate
    // limiting or a reviewer is offline, which is a failure that says nothing
    // about the code. Anything that genuinely needs live Hedera state runs
    // against a forked node started with `yarn hardhat:fork`.
    hardhat: forkingEnabled
      ? {
          forking: {
            url: hederaRpcUrl,
            // @ts-expect-error - custom property for hedera-forking plugin
            chainId: 296,
            workerPort: 10001,
          },
        }
      : {},
    hederaTestnet: {
      url: hederaRpcUrl,
      accounts: [deployerPrivateKey],
      chainId: 296,
    },
  },
  // Hedera is now supported on the main Sourcify instance (sourcify.dev).
  // No custom verifier URL required — standard tooling works out of the box.
  // See: https://hedera.com/blog/smart-contract-verification-sourcify-dev-now-supported
  sourcify: {
    enabled: true,
  },
  // Disable Etherscan verification (Hedera uses Sourcify only)
  etherscan: {
    enabled: false,
    apiKey: {},
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

// Extend the deploy task to also generate TypeScript ABIs after deployment.
task("deploy").setAction(async (args, hre, runSuper) => {
  await runSuper(args);
  await generateTsAbis(hre);
});

// Extend the verify task to show HashScan link after Sourcify verification.
task("verify").setAction(async (args, hre, runSuper) => {
  await runSuper(args);

  const address = args.address;
  const chainId = hre.network.config.chainId;

  if (address && chainId === 296) {
    console.log(`\nHashScan: https://hashscan.io/testnet/contract/${address}`);
  }
});

export default config;
