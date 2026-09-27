import * as dotenv from "dotenv";
dotenv.config();
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawn } from "child_process";

/**
 * Decrypts the deployer key, then runs a Hardhat task on Hedera testnet with it.
 *
 *   ts-node scripts/runHardhatDeployWithPK.ts deploy
 *   ts-node scripts/runHardhatDeployWithPK.ts run scripts/runLifecycle.ts
 *
 * Every task that signs as the deployer goes through here. Run any other way,
 * hardhat.config.ts falls back to Hardhat's PUBLIC test key, which holds no
 * testnet HBAR, so the task fails on its first transaction.
 *
 * `--network hederaTestnet` is added when omitted. Any other network is
 * refused: the frontend targets testnet alone, and the Chainlink proxies the
 * deploy registers exist nowhere else.
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("🚫️ Name a Hardhat task, e.g. `deploy` or `run scripts/runLifecycle.ts`");
    process.exit(1);
  }

  const networkIndex = args.indexOf("--network");
  if (networkIndex === -1) {
    args.push("--network", "hederaTestnet");
  } else if (args[networkIndex + 1] !== "hederaTestnet") {
    console.log(`🚫️ This template runs on Hedera testnet only (got "${args[networkIndex + 1]}")`);
    process.exit(1);
  }

  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;

  if (!encryptedKey) {
    console.log("🚫️ You don't have a deployer account. Run `yarn account:generate` or `yarn account:import` first");
    process.exit(1);
  }

  const pass = await password({ message: "Enter password to decrypt private key:" });

  let privateKey: string;
  try {
    privateKey = (await Wallet.fromEncryptedJson(encryptedKey, pass)).privateKey;
  } catch {
    console.error("Failed to decrypt private key. Wrong password?");
    process.exit(1);
  }

  const hardhat = spawn("hardhat", args, {
    stdio: "inherit",
    // Only the child process sees the decrypted key; it is never written down.
    env: { ...process.env, __RUNTIME_DEPLOYER_PRIVATE_KEY: privateKey },
    shell: process.platform === "win32",
  });

  hardhat.on("exit", code => {
    process.exit(code || 0);
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
