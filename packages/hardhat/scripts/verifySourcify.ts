/**
 * Verify a deployed contract on Sourcify, which is what HashScan reads.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS INSTEAD OF `yarn hardhat:verify:testnet`
 *
 * The bundled `@nomicfoundation/hardhat-verify` (2.x) talks to Sourcify's V1
 * API, and Sourcify has retired it. The endpoint the plugin calls now returns
 * an HTML 404:
 *
 *   GET https://sourcify.dev/server/check-all-by-addresses
 *   -> <!DOCTYPE html> ... Cannot GET /check-all-by-addresses
 *
 * which surfaces through Hardhat as the unhelpful:
 *
 *   A network request failed. This is an error from the block explorer, not
 *   Hardhat. Error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * That message points at the explorer, so it reads like an outage. It is not:
 * Sourcify's V2 API is healthy and does recognise Hedera. Only the plugin's
 * route is gone. Upgrading the plugin means moving to Hardhat 3, which is a
 * much larger change than this file.
 *
 * Verified working against chain 296 on 19 September 2026.
 * See NOTES-failures.md #17.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   yarn hardhat:verify:sourcify <address> [Contract:Name]
 */
import fs from "node:fs";
import path from "node:path";

const SOURCIFY = "https://sourcify.dev/server";
const BUILD_INFO_DIR = path.join(__dirname, "..", "artifacts", "build-info");

/** Hedera chain ids. Sourcify supports all of them. */
const CHAIN_IDS: Record<string, string> = {
  hederaMainnet: "295",
  hederaTestnet: "296",
  hederaPreviewnet: "297",
};

/**
 * Find the build-info that actually compiled this contract.
 *
 * A project accumulates several: one per distinct compilation. Picking the
 * wrong one yields a mismatch rather than an error, so match on the source
 * path rather than on whichever file is newest.
 */
function findBuildInfo(sourceName: string): { input: unknown; solcLongVersion: string } {
  const files = fs.readdirSync(BUILD_INFO_DIR).filter(f => f.endsWith(".json"));
  const candidates: { file: string; parsed: any; sourceCount: number }[] = [];

  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, file), "utf8"));
    if (parsed.input?.sources?.[sourceName]) {
      candidates.push({ file, parsed, sourceCount: Object.keys(parsed.input.sources).length });
    }
  }

  if (candidates.length === 0) {
    throw new Error(`No build-info contains ${sourceName}. Run \`yarn hardhat:compile\` first.`);
  }

  // Prefer the SMALLEST compilation unit containing the contract. A build-info
  // carrying a dozen unrelated sources is usually a stale one from before
  // files were removed, and Sourcify only needs the sources this contract
  // actually uses.
  candidates.sort((a, b) => a.sourceCount - b.sourceCount);
  return candidates[0].parsed;
}

async function main() {
  const [address, identifierArg] = process.argv.slice(2);

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error("Usage: yarn hardhat:verify:sourcify <0xaddress> [contracts/X.sol:X]");
    process.exit(1);
  }

  const identifier = identifierArg ?? "contracts/AssociationProbe.sol:AssociationProbe";
  const [sourceName] = identifier.split(":");

  const networkName = process.env.HARDHAT_NETWORK ?? "hederaTestnet";
  const chainId = CHAIN_IDS[networkName] ?? "296";

  console.log(`Verifying ${identifier}`);
  console.log(`  address  ${address}`);
  console.log(`  chain    ${chainId} (${networkName})`);

  const info = findBuildInfo(sourceName);

  const submit = await fetch(`${SOURCIFY}/v2/verify/${chainId}/${address}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: info.input,
      compilerVersion: info.solcLongVersion,
      contractIdentifier: identifier,
    }),
  });

  if (submit.status === 409) {
    console.log("\nAlready verified.");
    console.log(`  https://hashscan.io/${networkName === "hederaMainnet" ? "mainnet" : "testnet"}/contract/${address}`);
    return;
  }

  const submitted = (await submit.json()) as { verificationId?: string; message?: string };
  if (!submit.ok || !submitted.verificationId) {
    throw new Error(`Sourcify rejected the request (${submit.status}): ${submitted.message ?? "no message"}`);
  }

  // V2 is asynchronous: submission returns a job id, not a result.
  process.stdout.write("  waiting");
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    process.stdout.write(".");

    const poll = await fetch(`${SOURCIFY}/v2/verify/${submitted.verificationId}`);
    const job = (await poll.json()) as any;
    if (!job.isJobCompleted) continue;

    console.log("");
    const explorer = networkName === "hederaMainnet" ? "mainnet" : "testnet";

    // Sourcify reports "already verified" as a job error rather than as a
    // 409 on submission. It is a success for our purposes — the contract is
    // verified, which is the only thing the caller asked about — so treat it
    // as one rather than exiting non-zero and looking like a failure in CI.
    const message: string = job.error?.message ?? job.error?.customCode ?? "";
    if (/already verified/i.test(message)) {
      console.log("  already verified — nothing to do");
      console.log(`  https://hashscan.io/${explorer}/contract/${address}`);
      return;
    }

    if (job.error || !job.contract?.match) {
      throw new Error(`Verification failed: ${message || JSON.stringify(job).slice(0, 200)}`);
    }

    console.log(`\n  ${job.contract.match}  (runtime: ${job.contract.runtimeMatch})`);
    console.log(`  https://hashscan.io/${explorer}/contract/${address}`);
    console.log(`  https://repo.sourcify.dev/contracts/full_match/${chainId}/${address}/`);
    return;
  }

  throw new Error("Timed out waiting for Sourcify. The job may still complete; re-run to check.");
}

main().catch(error => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
