/**
 * Create the consensus topic this deployment writes its evidence to.
 *
 * Run once per deployment:
 *
 *     yarn evidence:topic
 *
 * It prints a topic id and the mirror-node URL for it. Put the id in
 * NEXT_PUBLIC_EVIDENCE_TOPIC so /evidence opens on it by default.
 *
 * ---------------------------------------------------------------------------
 * THE TOPIC GETS A SUBMIT KEY
 *
 * A topic created without one accepts messages from anyone on the network.
 * For an audit trail that is usually the wrong choice: it means a third party
 * can append a plausible-looking `settled` record to your evidence, and a
 * reader has no way to tell it from yours. So a submit key is the default and
 * `--open` is what you type to give that up.
 *
 * Either way the topic is PUBLIC to read. The key controls who can write.
 * ---------------------------------------------------------------------------
 *
 * This needs an operator, which the rest of the template mostly does not.
 * Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in packages/hardhat/.env —
 * see .env.example. Nothing else in this repository needs them: the feed
 * reader, the evidence reader and both credential-free routes run without.
 */
import * as dotenv from "dotenv";
import { createTopic, operatorFromEnv } from "../../nextjs/lib/settlement/hcsPublisher";
import { topicUrl } from "../../nextjs/lib/settlement/hcs";

dotenv.config();

async function main() {
  const open = process.argv.includes("--open");

  const operator = operatorFromEnv();
  if (!operator) {
    console.error(
      [
        "No operator configured.",
        "",
        "Creating a topic is a paid transaction, so it needs an account to pay.",
        "Set these in packages/hardhat/.env:",
        "",
        "  HEDERA_OPERATOR_ID=0.0.xxxxx",
        "  HEDERA_OPERATOR_KEY=<DER or ECDSA hex private key>",
        "  HEDERA_NETWORK=testnet",
        "",
        "Fund the account at https://portal.hedera.com/faucet.",
        "",
        "Nothing else in this template needs these. /feeds and /evidence both",
        "work with no credentials at all.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const network = operator.network ?? "testnet";
  console.log(`Creating an evidence topic on ${network} as ${operator.accountId}…`);
  if (open) {
    console.log("  --open: NO submit key. Anyone on the network will be able to append to this topic.");
  }

  const { topicId, submitKeyRequired } = await createTopic(operator, { open });

  console.log("");
  console.log(`  topic        ${topicId}`);
  console.log(`  submit key   ${submitKeyRequired ? "yes — only the operator can write" : "NO — anyone can write"}`);
  console.log(`  read it      ${topicUrl(topicId, network)}`);
  console.log(`  explorer     https://hashscan.io/${network}/topic/${topicId}`);
  console.log("");
  console.log("Add this to packages/nextjs/.env.local so /evidence opens on it:");
  console.log("");
  console.log(`  NEXT_PUBLIC_EVIDENCE_TOPIC=${topicId}`);
}

main().catch(error => {
  // The SDK's own errors are already translated by hcsPublisher into
  // something actionable; printing the stack on top of that buries it.
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
