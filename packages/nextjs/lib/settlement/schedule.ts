/**
 * Hedera Schedule Service: letting the network push the expiry.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE TRUSTING A SCHEDULE WITH ANYTHING
 *
 * A scheduled expiry is a CONVENIENCE, not the guarantee. The guarantee lives
 * in PolicyRegistry: `expire()` checks the deadline itself and is
 * permissionless, so once a policy is past its deadline literally anyone can
 * expire it and unlock the creator's refund. Invariant I5 is upheld by that
 * check, and its tests never touch HSS.
 *
 * What HSS buys is that nobody has to be watching. Without it, a policy whose
 * condition never fires sits there until some human or cron notices. With it,
 * the network itself submits the call at the deadline.
 *
 * The distinction matters because a schedule can fail for reasons that have
 * nothing to do with this code: the payer account runs dry, the schedule is
 * deleted, the node throttles. If any of that happens, the system degrades to
 * "someone must call expire()" rather than to "the escrow is stuck". Designing
 * it the other way round — making HSS load-bearing — would make a convenience
 * feature into a custody risk.
 * ---------------------------------------------------------------------------
 *
 * IS A SCHEDULED CONTRACT CALL ACTUALLY ALLOWED? CHECKED, NOT ASSUMED.
 *
 * `ContractCallTransactionBody` appears in the SchedulableTransactionBody
 * oneof, but the protobuf permitting a type is not the same as the network
 * accepting it: `scheduling.whitelist` is a node property, and contract calls
 * were excluded from it for years. Documentation on this is thin enough to be
 * worth checking directly, so the schedules Hedera has actually accepted were
 * decoded from the mirror node on 21 September 2026:
 *
 *   mainnet, 3,000 most recent schedules
 *     cryptoTransfer 2,525 · tokenBurn 315 · contractCall 88 · tokenMint 45
 *     cryptoApproveAllowance 9 · cryptoUpdateAccount 8 · tokenUpdate 6
 *     tokenCreation 2 · consensusSubmitMessage 2
 *
 *   testnet, 2,500 OLDEST schedules (Feb 2024)
 *     cryptoTransfer 2,315 · consensusSubmitMessage 139 · tokenMint 24
 *     tokenBurn 22 — and not one contractCall
 *
 * So it is permitted now and was not in early 2024. The most recent accepted
 * contract-call schedule in the mainnet sample was 15 September 2026, six days
 * before this was written. That is the evidence this module is built on. If a
 * ScheduleCreate here ever comes back NOT_IN_WHITELIST, the network changed
 * its mind, and `describeScheduleError` names that case specifically rather
 * than letting it surface as an opaque status.
 *
 * ---------------------------------------------------------------------------
 *
 * As with HCS, the halves are split by what they need. Reading a schedule's
 * fate takes an HTTP GET and no credentials. Creating one takes an operator.
 *
 * Framework-free.
 */
import type { HederaNetwork } from "./hcs";
import { mirrorBase } from "./hcs";
import { type OperatorCredentials, parseOperatorKey } from "./hcsPublisher";

/**
 * The longest a schedule may wait, per HIP-423.
 *
 * Taken from the spec rather than measured, because measuring it means
 * creating a schedule that is rejected and paying for the privilege. If the
 * network disagrees the ScheduleCreate fails at once with a clear status, so
 * the cost of this constant being wrong is an immediate error rather than a
 * policy that silently never expires.
 */
export const MAX_SCHEDULE_SECONDS = 62 * 24 * 60 * 60;

export interface ScheduledExpiry {
  scheduleId: string;
  /** Unix seconds at which the network will submit the call. */
  executesAt: number;
  /** The contract and policy it will act on, for display. */
  policyId: number;
  /** True when the schedule waits for its expiration rather than firing early. */
  waitsForExpiry: boolean;
}

/** What the mirror node says became of a schedule. No credentials needed. */
export interface ScheduleFate {
  scheduleId: string;
  /** Set once the network has submitted the inner transaction. */
  executedAt: string | null;
  deleted: boolean;
  expirationTime: string | null;
  /** The URL this came from, so the claim is checkable. */
  source: string;
}

export class ScheduleFailed extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ScheduleFailed";
  }
}

/**
 * Ask the network to call `expire(policyId)` at the deadline.
 *
 * @param registryEvmAddress The PolicyRegistry, as an EVM address.
 * @param deadline Unix seconds. Must match the policy's on-chain deadline —
 *        a schedule set earlier would fire against a policy the contract
 *        still considers live, and the call would revert harmlessly but
 *        leave the policy unexpired with no second attempt.
 */
export async function scheduleExpiry(
  operator: OperatorCredentials,
  args: { registryEvmAddress: string; policyId: number; deadline: number; gas?: number },
): Promise<ScheduledExpiry> {
  // Every guard below runs BEFORE the SDK is imported. Loading it costs about
  // three seconds, and none of these checks need a byte of it.
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.registryEvmAddress)) {
    throw new ScheduleFailed(`"${args.registryEvmAddress}" is not an EVM address`);
  }
  if (!Number.isInteger(args.policyId) || args.policyId < 0) {
    throw new ScheduleFailed("policyId must be a non-negative integer");
  }

  const now = Math.floor(Date.now() / 1000);
  const waitSeconds = args.deadline - now;
  if (waitSeconds <= 0) {
    // Nothing to schedule: the policy is already expirable by anyone.
    throw new ScheduleFailed(
      `deadline ${args.deadline} has already passed — call expire() directly instead of scheduling it`,
    );
  }
  if (waitSeconds > MAX_SCHEDULE_SECONDS) {
    throw new ScheduleFailed(
      `a schedule cannot wait ${Math.round(waitSeconds / 86_400)} days; HIP-423 caps it at ` +
        `${MAX_SCHEDULE_SECONDS / 86_400}. Expire this policy manually, or shorten its window.`,
    );
  }

  const { ContractExecuteTransaction, ContractFunctionParameters, ContractId, ScheduleCreateTransaction, Timestamp } =
    await import("@hiero-ledger/sdk");

  const { client, accountId } = await scheduleClient(operator);
  try {
    const inner = new ContractExecuteTransaction()
      .setContractId(ContractId.fromEvmAddress(0, 0, args.registryEvmAddress))
      // expire() is permissionless, so the scheduled call needs no signature
      // beyond its payer's. That is what makes it schedulable at all.
      .setFunction("expire", new ContractFunctionParameters().addUint256(args.policyId))
      .setGas(args.gas ?? 200_000);

    const create = new ScheduleCreateTransaction()
      .setScheduledTransaction(inner)
      // WITHOUT THIS the network executes as soon as the required signatures
      // are present — which, for a permissionless call, is immediately. The
      // policy would be expired the moment it was created.
      .setWaitForExpiry(true)
      .setExpirationTime(Timestamp.fromDate(new Date(args.deadline * 1000)))
      .setPayerAccountId(accountId);

    const receipt = await (await create.execute(client)).getReceipt(client);
    const scheduleId = receipt.scheduleId?.toString();
    if (!scheduleId) throw new ScheduleFailed("schedule created but the receipt carried no schedule id");

    return { scheduleId, executesAt: args.deadline, policyId: args.policyId, waitsForExpiry: true };
  } catch (error) {
    if (error instanceof ScheduleFailed) throw error;
    throw new ScheduleFailed(`could not schedule expiry: ${describeScheduleError(error)}`, error);
  } finally {
    client.close();
  }
}

/**
 * What became of a schedule. Credential-free.
 *
 * Returning `null` for a schedule the mirror node does not know about is
 * deliberate: an expired-and-executed schedule is eventually pruned, and
 * treating "gone" as an error would make a completed lifecycle look broken.
 */
export async function scheduleFate(
  scheduleId: string,
  opts: { network?: HederaNetwork; fetchImpl?: typeof fetch } = {},
): Promise<ScheduleFate | null> {
  const network = opts.network ?? "testnet";
  const doFetch = opts.fetchImpl ?? fetch;

  if (!/^\d+\.\d+\.\d+$/.test(scheduleId)) {
    throw new ScheduleFailed(`"${scheduleId}" is not a schedule id — expected 0.0.x`);
  }

  const source = `${mirrorBase(network)}/api/v1/schedules/${scheduleId}`;
  const response: Response = await doFetch(source);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ScheduleFailed(`mirror node returned ${response.status} for schedule ${scheduleId}`);
  }

  const payload = (await response.json()) as {
    executed_timestamp?: string | null;
    deleted?: boolean;
    expiration_time?: string | null;
  };

  return {
    scheduleId,
    executedAt: payload.executed_timestamp ?? null,
    deleted: payload.deleted === true,
    expirationTime: payload.expiration_time ?? null,
    source,
  };
}

async function scheduleClient(operator: OperatorCredentials) {
  const { AccountId, Client, PrivateKey } = await import("@hiero-ledger/sdk");
  const network = operator.network ?? "testnet";
  const client =
    network === "mainnet"
      ? Client.forMainnet()
      : network === "previewnet"
        ? Client.forPreviewnet()
        : Client.forTestnet();

  // Shared with hcsPublisher rather than duplicated. The try/catch version
  // that used to live here had the same latent bug: fromStringDer accepts a
  // raw ECDSA hex string, returns the wrong key, and the fallback is never
  // reached. See parseOperatorKey for the detail.
  client.setOperator(operator.accountId, parseOperatorKey(operator.privateKey, PrivateKey, operator.keyType));

  // setPayerAccountId wants an AccountId, not the string form. Passing the
  // string compiles under a loose signature and fails at runtime.
  return { client, accountId: AccountId.fromString(operator.accountId) };
}

/** Hedera's statuses are precise and unreadable. These are the ones this path provokes. */
export function describeScheduleError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);

  if (text.includes("SCHEDULED_TRANSACTION_NOT_IN_WHITELIST")) {
    return (
      "this network will not schedule contract calls — its scheduling.whitelist excludes them. " +
      "The policy still expires: expire() is permissionless, so call it directly at the deadline."
    );
  }
  if (text.includes("SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE")) {
    return `the deadline is beyond the ${MAX_SCHEDULE_SECONDS / 86_400}-day scheduling limit`;
  }
  if (text.includes("SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME")) {
    return "the deadline is in the past by the time the network saw this";
  }
  if (text.includes("IDENTICAL_SCHEDULE_ALREADY_CREATED")) {
    // Not an error in practice: the existing schedule does the job.
    return "an identical schedule already exists and will fire at the same time";
  }
  if (text.includes("INSUFFICIENT_PAYER_BALANCE")) {
    return "the operator account has no HBAR — fund it at the testnet faucet";
  }
  if (text.includes("INVALID_CONTRACT_ID")) {
    return "no contract at that address on this network — check HEDERA_NETWORK";
  }
  return text;
}
