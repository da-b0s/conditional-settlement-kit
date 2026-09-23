/**
 * Publish the on-chain history to the evidence topic.
 *
 *     EVIDENCE_TOPIC=0.0.xxxxx yarn evidence:publish --network hederaTestnet
 *
 * The topic comes from the environment, not a flag. `hardhat run` parses the
 * command line itself and rejects anything it does not recognise with
 * "HH305: Unrecognized param --topic", so a --topic flag cannot reach this
 * script. NEXT_PUBLIC_EVIDENCE_TOPIC works too, so a configured frontend and
 * this script stay in step without setting it twice.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCRIPT AND NOT A HOOK IN THE SETTLEMENT PATH
 *
 * The tempting design is to publish from the app the moment a policy settles.
 * It is the wrong one, for two reasons.
 *
 * Publishing costs HBAR and needs an operator key. Wiring that into the
 * settlement path would mean either the app holds a key — so a public route
 * spends money on behalf of whoever clicks — or settlement fails when the
 * operator is unfunded. Settlement must never depend on the evidence trail;
 * the trail describes what happened, it does not cause it.
 *
 * And the chain is already the record. Events are durable and ordered whether
 * or not anything publishes them, so this script can run late, run twice, or
 * never run, and no settlement is affected. What the topic adds is a
 * counterparty-readable summary that needs no RPC access, no ABI and no
 * knowledge of which contract to look at.
 *
 * So: derive from events, publish separately, and make it idempotent.
 * ---------------------------------------------------------------------------
 *
 * IDEMPOTENCE
 *
 * The topic is append-only and permanent, so publishing the same settlement
 * twice cannot be undone. Before writing anything this reads the topic back
 * and skips every (kind, policyId) pair already there. Running it twice in a
 * row publishes nothing the second time.
 *
 * ONE TOPIC PER DEPLOYMENT. That key is (kind, policyId) and carries no
 * contract address, so pointing a second registry at the same topic would
 * make its policy #1 look already-published and skip it silently. The
 * address is deliberately NOT in the record — evidence.ts refuses anything
 * shaped like an address, and weakening that guard to solve a bookkeeping
 * problem would be the wrong trade. Create a topic per deployment instead;
 * yarn evidence:topic takes a few seconds.
 */
import * as dotenv from "dotenv";
import { deployments, ethers } from "hardhat";
import { buildEvidence, type EvidenceKind } from "../../nextjs/lib/settlement/evidence";
import { readEvidence, type HederaNetwork } from "../../nextjs/lib/settlement/hcs";
import { operatorFromEnv, publishEvidence } from "../../nextjs/lib/settlement/hcsPublisher";

dotenv.config();

/** Contract event -> evidence kind. Only these reach the topic. */
const EVENTS: { event: string; kind: EvidenceKind }[] = [
  { event: "PolicyCreated", kind: "policy_created" },
  { event: "PolicyTriggered", kind: "triggered" },
  { event: "PolicySettled", kind: "settled" },
  { event: "PolicyExpired", kind: "expired" },
  { event: "PolicyRefunded", kind: "refunded" },
];

async function main() {
  const topicId = process.env.EVIDENCE_TOPIC ?? process.env.NEXT_PUBLIC_EVIDENCE_TOPIC;
  if (!topicId) {
    console.error("Set EVIDENCE_TOPIC (or NEXT_PUBLIC_EVIDENCE_TOPIC) to the topic to publish to.");
    console.error("  EVIDENCE_TOPIC=0.0.xxxxx yarn evidence:publish --network hederaTestnet");
    console.error("");
    console.error("It is an environment variable rather than a flag because `hardhat run` rejects");
    console.error("unrecognised command-line params before this script ever runs.");
    console.error("Create a topic with `yarn evidence:topic`.");
    process.exitCode = 1;
    return;
  }

  const operator = operatorFromEnv();
  if (!operator) {
    console.error("No operator configured. Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY — see .env.example.");
    process.exitCode = 1;
    return;
  }
  const network = (operator.network ?? "testnet") as HederaNetwork;

  const registry = await ethers.getContract("PolicyRegistry");
  const address = await registry.getAddress();
  console.log(`Reading PolicyRegistry at ${address}`);

  // ---------------------------------------------------------------------
  // HEDERA CAPS eth_getLogs AT A SEVEN-DAY WINDOW.
  //
  // `queryFilter(filter)` with no range asks for block 0 to latest, and the
  // relay refuses:
  //
  //   The provided fromBlock and toBlock contain timestamps that exceed the
  //   maximum allowed duration of 7 days
  //
  // So start at the block the registry was deployed in — there cannot be
  // events before it — and walk forward in windows. Blocks are about two
  // seconds apart, so seven days is roughly 302,000 of them; 250,000 leaves
  // room for the arithmetic being approximate.
  // ---------------------------------------------------------------------
  const deployment = await deployments.get("PolicyRegistry");
  const deployedAt = deployment.receipt?.blockNumber ?? 0;
  const latest = await ethers.provider.getBlockNumber();
  const WINDOW = 250_000;

  const queryChunked = async (filter: Parameters<typeof registry.queryFilter>[0]) => {
    const found = [];
    for (let from = deployedAt; from <= latest; from += WINDOW) {
      const to = Math.min(from + WINDOW - 1, latest);
      found.push(...(await registry.queryFilter(filter, from, to)));
    }
    return found;
  };
  console.log(`  scanning blocks ${deployedAt} to ${latest}`);

  // What is already on the topic. Publishing is permanent, so this runs first.
  const existing = await readEvidence(topicId, { network }).catch(error => {
    // A topic with no messages yet is the normal first run.
    if (error instanceof Error && error.message.includes("does not exist")) throw error;
    console.warn(`  could not read the topic back (${error}); refusing to publish blind.`);
    throw error;
  });
  const already = new Set(existing.entries.filter(e => e.record).map(e => `${e.record!.kind}:${e.record!.policyId}`));
  console.log(`  topic ${topicId} already holds ${already.size} evidence records`);

  const asset = (value: unknown) => String(value);
  const pending: { kind: EvidenceKind; policyId: number; at: number; assetHash: string; price?: bigint }[] = [];

  for (const { event, kind } of EVENTS) {
    const logs = await queryChunked(registry.filters[event]());
    for (const log of logs) {
      const parsed = "args" in log ? log.args : undefined;
      if (!parsed) continue;
      const policyId = Number(parsed.policyId);
      if (already.has(`${kind}:${policyId}`)) continue;

      // The asset hash is on the policy, not on every event, so read it back.
      const policy = await registry.getPolicy(policyId);
      const block = await log.getBlock();

      pending.push({
        kind,
        policyId,
        at: block.timestamp,
        assetHash: asset(policy.asset),
        // Only the triggering observation carries a price.
        price: kind === "triggered" || kind === "settled" ? BigInt(policy.triggerPrice) : undefined,
      });
    }
  }

  // Consensus order, so the trail reads as a lifecycle rather than grouped by
  // event type.
  pending.sort((a, b) => a.at - b.at || a.policyId - b.policyId);

  if (pending.length === 0) {
    console.log("\nNothing to publish — the topic is up to date.");
    return;
  }

  console.log(`\nPublishing ${pending.length} record${pending.length === 1 ? "" : "s"}:`);
  for (const item of pending) {
    // buildEvidence refuses anything that should not be public, and does it
    // again inside publishEvidence immediately before submission.
    const record = buildEvidence({
      kind: item.kind,
      policyId: item.policyId,
      at: item.at,
      assetHash: item.assetHash,
      ...(item.price !== undefined && item.price > 0n ? { price: item.price } : {}),
    });

    const result = await publishEvidence(operator, topicId, record);
    console.log(
      `  #${result.sequenceNumber}  ${item.kind.padEnd(14)} policy ${item.policyId}  (${result.bytes} bytes)`,
    );
  }

  console.log(`\nRead it back: https://hashscan.io/${network}/topic/${topicId}`);
}

main().catch(error => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
