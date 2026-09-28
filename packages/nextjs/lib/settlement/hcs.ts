/**
 * Reading the public evidence trail back.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAS NO CREDENTIALS IN IT
 *
 * A consensus topic is public. Reading one needs no operator account, no key,
 * no `.env` and no wallet — just an HTTP GET against the mirror node. That is
 * the whole reason the evidence trail is worth having: a counterparty can
 * audit a settlement without being given access to anything.
 *
 * So the read path lives here, with `fetch` as its only dependency, and the
 * write path lives in hcsPublisher.ts, which needs an operator and is
 * therefore server-only. Keeping them apart is not tidiness. It means a
 * Server Component can render the trail on a machine that has never seen a
 * key, and it means the Hiero SDK never reaches the client bundle.
 * ---------------------------------------------------------------------------
 *
 * WHAT COMES BACK IS NOT TRUSTED
 *
 * Anyone holding the submit key writes to the topic, and a topic created
 * without one accepts messages from anybody. A message read back is therefore
 * untrusted input: it may be malformed, truncated, someone else's JSON, or a
 * record written by an older version of this schema. `readEvidence` reports
 * what it could not parse rather than dropping it, because a gap in an audit
 * trail that nobody is told about is worse than a visible one.
 *
 * Framework-free. See invariants.ts.
 */
import type { EvidenceKind, EvidenceRecord } from "./evidence";
import { withReadDeadline } from "./readDeadline";

export type HederaNetwork = "mainnet" | "testnet" | "previewnet";

const MIRROR_BASE: Record<HederaNetwork, string> = {
  mainnet: "https://mainnet.mirrornode.hedera.com",
  testnet: "https://testnet.mirrornode.hedera.com",
  previewnet: "https://previewnet.mirrornode.hedera.com",
};

/**
 * This deployment's evidence topic on testnet, created for the contracts in
 * contracts/deployedContracts.ts. Public configuration, not a secret, so it
 * lives in code: a fresh clone opens /evidence on it with no env file.
 * NEXT_PUBLIC_EVIDENCE_TOPIC overrides it for your own deployment.
 */
export const PROJECT_EVIDENCE_TOPIC = "0.0.10743528";

export function projectEvidenceTopic(env: Record<string, string | undefined> = process.env): string {
  return env.NEXT_PUBLIC_EVIDENCE_TOPIC?.trim() || PROJECT_EVIDENCE_TOPIC;
}

/** `0.0.12345`, the only form the mirror node accepts in this path. */
const TOPIC_ID = /^\d+\.\d+\.\d+$/;

/** Year 9999. Anything later cannot be rendered as a Date. */
const MAX_UNIX_SECONDS = 253_402_300_799;

const KINDS: readonly EvidenceKind[] = ["policy_created", "triggered", "settled", "expired", "refunded"];

/** A message as the mirror node returns it, plus what we made of it. */
export interface TopicEntry {
  /** Consensus timestamp, `seconds.nanos`. The ledger's own ordering. */
  consensusTimestamp: string;
  /** Sequence number within the topic. Gaps here mean messages are missing. */
  sequenceNumber: number;
  /** The decoded payload, when it parsed as an evidence record. */
  record?: EvidenceRecord;
  /** Why it did not parse. Present exactly when `record` is absent. */
  unparsed?: { raw: string; reason: string };
}

export interface EvidenceTrail {
  topicId: string;
  network: HederaNetwork;
  entries: TopicEntry[];
  /** Entries this module could not read as evidence. Never hidden. */
  unreadable: number;
  /**
   * Sequence numbers missing from the range returned. A non-empty list means
   * the trail has holes — either paging stopped early, or messages exist that
   * the mirror node has not surfaced yet.
   */
  gaps: number[];
  /**
   * True when the page budget ran out while the mirror node still had more.
   * Later messages exist that this read did not fetch, so the trail — and any
   * lifecycle checked against it — is incomplete. Gaps cannot show this: the
   * missing messages come after the last one read, not between two of them.
   */
  truncated: boolean;
  /** The mirror node URL used, so a reader can check the claim themselves. */
  source: string;
}

export class TopicReadFailed extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TopicReadFailed";
  }
}

export function mirrorBase(network: HederaNetwork): string {
  return MIRROR_BASE[network];
}

/** The URL a reader can paste into a browser to check any of this. */
export function topicUrl(topicId: string, network: HederaNetwork = "testnet"): string {
  return `${MIRROR_BASE[network]}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
}

function decodeBase64(value: string): string {
  // Buffer in Node, atob in a browser or edge runtime. Neither is assumed.
  if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf8");
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Parse one message body into an evidence record, or say why not.
 *
 * Deliberately strict. A record missing `v` came from a schema this code does
 * not know, and guessing at it would put invented data in an audit trail.
 */
export function parseEvidence(body: string): { record: EvidenceRecord } | { reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { reason: "not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) return { reason: "not an object" };

  const candidate = parsed as Record<string, unknown>;
  if (candidate.v === undefined) return { reason: "Not a settlement evidence record (missing schema version)" };
  if (candidate.v !== 1) return { reason: `unknown schema version ${JSON.stringify(candidate.v)}` };
  if (typeof candidate.kind !== "string" || !KINDS.includes(candidate.kind as EvidenceKind)) {
    return { reason: `unknown kind ${JSON.stringify(candidate.kind)}` };
  }
  if (!Number.isInteger(candidate.policyId)) return { reason: "policyId is not an integer" };
  if (!Number.isInteger(candidate.at)) return { reason: "at is not an integer" };
  if (typeof candidate.assetHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate.assetHash)) {
    return { reason: "assetHash is not a 32-byte hex hash" };
  }

  // The optional fields are rendered too, so they are checked too. Anyone can
  // write to an open topic: an `observedAt` of 1e20 makes a date render throw,
  // and an object in `price` crashes React, taking the whole page down with a
  // single message.
  if (candidate.price !== undefined && (typeof candidate.price !== "string" || !/^\d{1,78}$/.test(candidate.price))) {
    return { reason: "price is not a non-negative integer string" };
  }
  if (
    candidate.observedAt !== undefined &&
    (!Number.isInteger(candidate.observedAt) ||
      (candidate.observedAt as number) < 0 ||
      (candidate.observedAt as number) > MAX_UNIX_SECONDS)
  ) {
    return { reason: "observedAt is not a unix timestamp" };
  }
  if (
    candidate.txHash !== undefined &&
    (typeof candidate.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate.txHash))
  ) {
    return { reason: "txHash is not a 32-byte hex hash" };
  }

  return { record: candidate as unknown as EvidenceRecord };
}

/**
 * Read a topic's evidence trail from the mirror node.
 *
 * @param topicId `0.0.x` form.
 * @param opts.maxPages A hard budget. The mirror node pages indefinitely, and
 *        a topic with a runaway writer would otherwise hang a page render.
 */
export async function readEvidence(
  topicId: string,
  opts: { network?: HederaNetwork; maxPages?: number; fetchImpl?: typeof fetch } = {},
): Promise<EvidenceTrail> {
  return withReadDeadline(signal => readEvidenceWithinDeadline(topicId, opts, signal));
}

async function readEvidenceWithinDeadline(
  topicId: string,
  opts: { network?: HederaNetwork; maxPages?: number; fetchImpl?: typeof fetch },
  signal: AbortSignal,
): Promise<EvidenceTrail> {
  const network = opts.network ?? "testnet";
  const maxPages = opts.maxPages ?? 10;
  const doFetch = opts.fetchImpl ?? fetch;

  if (!TOPIC_ID.test(topicId)) {
    throw new TopicReadFailed(`"${topicId}" is not a topic id — expected 0.0.x`);
  }

  const base = MIRROR_BASE[network];
  const first = `/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
  const entries: TopicEntry[] = [];

  let path: string | null = first;
  for (let page = 0; page < maxPages && path; page++) {
    const response: Response = await doFetch(`${base}${path}`, { signal, cache: "no-store" });
    if (response.status === 404) {
      throw new TopicReadFailed(`topic ${topicId} does not exist on ${network}`, 404);
    }
    if (!response.ok) {
      throw new TopicReadFailed(`mirror node returned ${response.status} for topic ${topicId}`, response.status);
    }

    const payload = (await response.json()) as {
      messages?: { consensus_timestamp: string; sequence_number: number; message: string }[];
      links?: { next?: string | null };
    };

    for (const message of payload.messages ?? []) {
      const body = decodeBase64(message.message);
      const outcome = parseEvidence(body);
      entries.push({
        consensusTimestamp: message.consensus_timestamp,
        sequenceNumber: message.sequence_number,
        ...("record" in outcome
          ? { record: outcome.record }
          : // Truncate: an unparsed body is written by whoever holds the submit
            // key and could be megabytes. Enough to diagnose, no more.
            { unparsed: { raw: body.slice(0, 200), reason: outcome.reason } }),
      });
    }

    // links.next already carries the /api/v1 prefix, so it is appended to the
    // bare base. Appending it to `${base}/api/v1` would double the prefix.
    path = payload.links?.next ?? null;
  }

  // THE MESSAGES ENDPOINT DOES NOT 404 FOR A TOPIC THAT DOES NOT EXIST.
  //
  // It answers 200 with `{"messages":[],"links":{"next":null}}`, which is
  // byte-for-byte what a real, empty topic returns. Taking that at face value
  // makes this page tell an auditor "this topic exists and has no messages"
  // about a topic that was never created — so a typo in a topic id reads as
  // "the settlement produced no evidence". That is the worst thing an audit
  // tool can get wrong.
  //
  // The entity endpoint does 404 properly, so ask it — but only when the list
  // came back empty. The normal path stays one request.
  if (entries.length === 0) {
    const probe = await doFetch(`${base}/api/v1/topics/${topicId}`, { signal, cache: "no-store" });
    if (probe.status === 404) {
      throw new TopicReadFailed(`topic ${topicId} does not exist on ${network}`, 404);
    }
    if (!probe.ok) {
      throw new TopicReadFailed(`Could not confirm this topic. Please try again.`, probe.status);
    }
  }

  return {
    topicId,
    network,
    entries,
    unreadable: entries.filter(e => e.unparsed).length,
    gaps: findGaps(entries.map(e => e.sequenceNumber)),
    truncated: path !== null,
    source: `${base}${first}`,
  };
}

/** Sequence numbers absent between the lowest and highest seen. */
export function findGaps(sequenceNumbers: number[]): number[] {
  if (sequenceNumbers.length === 0) return [];
  const seen = new Set(sequenceNumbers);
  const lo = Math.min(...sequenceNumbers);
  const hi = Math.max(...sequenceNumbers);
  const gaps: number[] = [];
  for (let n = lo; n <= hi; n++) if (!seen.has(n)) gaps.push(n);
  return gaps;
}

/**
 * The lifecycle of one policy, in consensus order.
 *
 * This is what makes the trail an audit rather than a log: the sequence of
 * kinds for a policy is checkable against the state machine in invariants.ts.
 */
export function trailForPolicy(trail: EvidenceTrail, policyId: number): EvidenceRecord[] {
  return trail.entries
    .map(e => e.record)
    .filter((r): r is EvidenceRecord => r !== undefined && r.policyId === policyId);
}
