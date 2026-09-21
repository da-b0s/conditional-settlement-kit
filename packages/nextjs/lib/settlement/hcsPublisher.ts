/**
 * Writing to the public evidence trail. Server-only.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE NEEDS AN OPERATOR. hcs.ts DOES NOT.
 *
 * Submitting to a topic costs HBAR and is signed by an operator account, so
 * everything here requires credentials. Reading needs none, which is why the
 * read path is a separate module: importing this one from a Server Component
 * that only wants to display the trail would drag the Hiero SDK and a key
 * requirement into a page that needs neither.
 *
 * The SDK is imported dynamically inside the functions rather than at the top
 * of the file. That is deliberate. A static import makes `@hiero-ledger/sdk`
 * a hard dependency of anything that so much as type-imports this module, and
 * the SDK is large and Node-only. Dynamic keeps the cost where the call is.
 * ---------------------------------------------------------------------------
 *
 * WHAT A SUBMIT KEY IS FOR
 *
 * A topic created without a submit key accepts messages from anyone on the
 * network. For an audit trail that is usually wrong: it means a third party
 * can append a plausible-looking `settled` record to your evidence. Topics
 * created here carry a submit key by default, and `createTopic` makes you
 * pass `{ open: true }` to opt out, so the permissive choice is the one you
 * have to type.
 *
 * Nothing in this file writes a record it did not build through
 * evidence.ts. `assertPublishable` runs again immediately before submission,
 * because that is the last point at which a mistake is still recallable.
 *
 * Framework-free — no React, no Next. It is server-only by virtue of needing
 * credentials, not by virtue of a framework directive.
 */
import { type EvidenceRecord, assertPublishable, serialiseEvidence } from "./evidence";
import type { HederaNetwork } from "./hcs";

export interface OperatorCredentials {
  /** `0.0.x`. */
  accountId: string;
  /** DER-encoded private key. Never logged, never returned, never published. */
  privateKey: string;
  network?: HederaNetwork;
}

export class PublishFailed extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PublishFailed";
  }
}

/**
 * Read operator credentials from the environment, or say precisely what is
 * missing.
 *
 * Returns `null` rather than throwing when nothing is configured, because
 * "no operator" is a normal state for this template: the read path and every
 * credential-free route work without one, and a thrown error at import time
 * would break them.
 */
export function operatorFromEnv(env: NodeJS.ProcessEnv = process.env): OperatorCredentials | null {
  const accountId = env.HEDERA_OPERATOR_ID?.trim();
  const privateKey = env.HEDERA_OPERATOR_KEY?.trim();
  if (!accountId && !privateKey) return null;

  if (!accountId) throw new PublishFailed("HEDERA_OPERATOR_KEY is set but HEDERA_OPERATOR_ID is not");
  if (!privateKey) throw new PublishFailed("HEDERA_OPERATOR_ID is set but HEDERA_OPERATOR_KEY is not");
  if (!/^\d+\.\d+\.\d+$/.test(accountId)) {
    throw new PublishFailed(`HEDERA_OPERATOR_ID is "${accountId}" — expected 0.0.x`);
  }

  const network = (env.HEDERA_NETWORK?.trim() as HederaNetwork | undefined) ?? "testnet";
  if (!["mainnet", "testnet", "previewnet"].includes(network)) {
    throw new PublishFailed(`HEDERA_NETWORK is "${network}" — expected mainnet, testnet or previewnet`);
  }

  return { accountId, privateKey, network };
}

/** Build a configured client. Callers must close it. */
async function clientFor(operator: OperatorCredentials) {
  const { Client, PrivateKey } = await import("@hiero-ledger/sdk");
  const network = operator.network ?? "testnet";

  const client =
    network === "mainnet" ? Client.forMainnet() : network === "previewnet" ? Client.forPreviewnet() : Client.forTestnet();

  let key;
  try {
    key = PrivateKey.fromStringDer(operator.privateKey);
  } catch {
    // ECDSA hex keys are the common case from a Hardhat-style .env, and the
    // DER parser's own error names nothing useful.
    try {
      key = PrivateKey.fromStringECDSA(operator.privateKey);
    } catch {
      throw new PublishFailed("operator key is neither DER nor ECDSA hex — check HEDERA_OPERATOR_KEY");
    }
  }

  client.setOperator(operator.accountId, key);
  return { client, key };
}

/**
 * Create a topic for this deployment's evidence.
 *
 * @param opts.open Create WITHOUT a submit key, letting anyone append. You
 *        have to ask for this; the default is a key held by the operator.
 * @param opts.memo A short public label. It lands on a public ledger, so it
 *        goes through the same guard as everything else.
 */
export async function createTopic(
  operator: OperatorCredentials,
  opts: { open?: boolean; memo?: string } = {},
): Promise<{ topicId: string; submitKeyRequired: boolean }> {
  const { TopicCreateTransaction } = await import("@hiero-ledger/sdk");
  const { client, key } = await clientFor(operator);

  if (opts.memo) {
    // A memo is free text, which is exactly the shape of field that leaks.
    assertPublishable({ v: 1, memoCheck: opts.memo } as unknown);
  }

  try {
    let tx = new TopicCreateTransaction();
    if (opts.memo) tx = tx.setTopicMemo(opts.memo);
    if (!opts.open) tx = tx.setSubmitKey(key.publicKey);

    const receipt = await (await tx.execute(client)).getReceipt(client);
    const topicId = receipt.topicId?.toString();
    if (!topicId) throw new PublishFailed("topic created but the receipt carried no topic id");

    return { topicId, submitKeyRequired: !opts.open };
  } catch (error) {
    if (error instanceof PublishFailed) throw error;
    throw new PublishFailed(`could not create topic: ${describe(error)}`, error);
  } finally {
    client.close();
  }
}

/**
 * Submit one evidence record.
 *
 * Returns the consensus timestamp and sequence number so a caller can link
 * straight to the message rather than telling the user to go and look.
 */
export async function publishEvidence(
  operator: OperatorCredentials,
  topicId: string,
  record: EvidenceRecord,
): Promise<{ topicId: string; sequenceNumber: number; consensusTimestamp: string; bytes: number }> {
  const { TopicMessageSubmitTransaction } = await import("@hiero-ledger/sdk");

  // Last chance. After execute() this is permanent.
  const message = serialiseEvidence(record);

  // A topic message is capped at 1024 bytes before the SDK chunks it, and a
  // chunked audit record is a record a reader has to reassemble. The schema
  // is small by design, so exceeding this means something went wrong upstream.
  const bytes = new TextEncoder().encode(message).length;
  if (bytes > 1024) {
    throw new PublishFailed(`evidence record is ${bytes} bytes — the schema should never exceed 1024`);
  }

  const { client } = await clientFor(operator);
  try {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(message)
      .execute(client);

    const receipt = await response.getReceipt(client);
    return {
      topicId,
      sequenceNumber: Number(receipt.topicSequenceNumber?.toString() ?? 0),
      consensusTimestamp: (await response.getRecord(client)).consensusTimestamp.toString(),
      bytes,
    };
  } catch (error) {
    throw new PublishFailed(`could not submit to topic ${topicId}: ${describe(error)}`, error);
  } finally {
    client.close();
  }
}

/**
 * Turn an SDK error into something a person can act on.
 *
 * The SDK's status codes are precise and unreadable. These are the ones this
 * template actually provokes; anything else is passed through rather than
 * flattened into a generic message.
 */
function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);

  if (text.includes("INSUFFICIENT_PAYER_BALANCE")) {
    return "the operator account has no HBAR — fund it at the testnet faucet";
  }
  if (text.includes("INVALID_TOPIC_ID")) {
    return "that topic does not exist on this network — check HEDERA_NETWORK";
  }
  if (text.includes("INVALID_SIGNATURE") || text.includes("UNAUTHORIZED")) {
    return "the operator key does not hold this topic's submit key";
  }
  if (text.includes("TOPIC_EXPIRED")) {
    return "the topic's auto-renew period lapsed and it was removed";
  }
  return text;
}
