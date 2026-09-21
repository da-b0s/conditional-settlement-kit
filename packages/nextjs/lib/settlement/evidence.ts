/**
 * What goes on the public record, and what must never.
 *
 * ---------------------------------------------------------------------------
 * INVARIANT I6: public evidence contains no secrets or personal data — hashes
 * and minimal summaries only.
 *
 * HCS topics are public and permanent. Anyone can read the whole history of a
 * topic from the mirror node with no key and no permission, forever. A field
 * added carelessly here cannot be unpublished; the best anyone can do
 * afterwards is append a correction beneath it.
 *
 * So the rule is inverted from the usual one. Rather than deciding what to
 * exclude, this module decides what may be included, and everything else is
 * refused. `buildEvidence` constructs the record field by field from a known
 * shape rather than spreading an input object, because a spread is how an
 * extra field arrives on a public ledger without anyone choosing to put it
 * there.
 * ---------------------------------------------------------------------------
 *
 * Framework-free. See invariants.ts.
 */

/** What happened. Deliberately a small closed set. */
export type EvidenceKind = "policy_created" | "triggered" | "settled" | "expired" | "refunded";

/**
 * The only shape that reaches a topic.
 *
 * Every field is a number, an enum, or a hash. There is no free-text field,
 * because free text is where an address, an email or a customer reference
 * eventually gets written.
 */
export interface EvidenceRecord {
  /** Schema version, so a reader can tell what it is looking at. */
  v: 1;
  kind: EvidenceKind;
  /** On-chain policy id. Public already. */
  policyId: number;
  /** Consensus-second the app believed it acted. */
  at: number;
  /** Price at 18dp, as a decimal string. Public already. */
  price?: string;
  /** The feed's own updatedAt. Lets a reader re-derive the age. */
  observedAt?: number;
  /** keccak of the asset key, e.g. hash of "HBAR/USD". Not the pair itself. */
  assetHash: string;
  /** keccak of the transaction that carried it, when there is one. */
  txHash?: string;
}

/** Fields that must never appear on a public topic, whatever the caller passes. */
export const FORBIDDEN_KEYS: readonly string[] = [
  "beneficiary",
  "creator",
  "address",
  "account",
  "accountId",
  "evmAddress",
  "email",
  "name",
  "memo",
  "note",
  "privateKey",
  "key",
  "secret",
  "mnemonic",
  "seed",
  "signature",
  "operatorId",
  "operatorKey",
] as const;

/** Anything that looks like a key, an address or an account id. */
const SECRET_SHAPES: readonly RegExp[] = [
  /\b0x[0-9a-fA-F]{40}\b/, // EVM address
  /\b0x[0-9a-fA-F]{64}\b/, // 32-byte hex — a key, or a raw hash left unlabelled
  /\b\d+\.\d+\.\d{3,}\b/, // Hedera account or token id
  /\b[0-9a-fA-F]{64}\b/, // bare 32-byte hex
  /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email
];

export class EvidenceRejected extends Error {
  constructor(
    readonly reason: string,
    readonly field?: string,
  ) {
    super(field ? `${reason} (field: ${field})` : reason);
    this.name = "EvidenceRejected";
  }
}

/**
 * Build a record for publication.
 *
 * Constructs explicitly rather than spreading. Every field that appears below
 * was chosen; nothing arrives by accident. `assetHash` must already be a hash
 * — passing "HBAR/USD" is refused, because a pair name today is a customer
 * reference tomorrow once somebody generalises the field.
 */
export function buildEvidence(input: {
  kind: EvidenceKind;
  policyId: number;
  at: number;
  assetHash: string;
  price?: bigint | string;
  observedAt?: number;
  txHash?: string;
}): EvidenceRecord {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.assetHash)) {
    throw new EvidenceRejected("assetHash must be a 32-byte hex hash, not a readable name", "assetHash");
  }
  if (!Number.isInteger(input.policyId) || input.policyId < 0) {
    throw new EvidenceRejected("policyId must be a non-negative integer", "policyId");
  }

  const record: EvidenceRecord = {
    v: 1,
    kind: input.kind,
    policyId: input.policyId,
    at: Math.floor(input.at),
    assetHash: input.assetHash,
  };

  if (input.price !== undefined) record.price = input.price.toString();
  if (input.observedAt !== undefined) record.observedAt = Math.floor(input.observedAt);
  if (input.txHash !== undefined) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
      throw new EvidenceRejected("txHash must be a 32-byte hex hash", "txHash");
    }
    record.txHash = input.txHash;
  }

  // Check the thing that actually gets published, not the object we think we
  // built. If serialisation introduces something, this is where it shows.
  assertPublishable(record);
  return record;
}

/**
 * Refuse a record that carries anything it should not.
 *
 * Runs against the SERIALISED form, because that is what reaches the topic.
 * A getter, a prototype field or a nested object would be invisible to a
 * key-by-key check and perfectly visible in the JSON.
 */
export function assertPublishable(record: unknown): asserts record is EvidenceRecord {
  const json = JSON.stringify(record);

  for (const key of FORBIDDEN_KEYS) {
    // Match the key as a JSON property name, not as a substring of a value.
    if (new RegExp(`"${key}"\\s*:`, "i").test(json)) {
      throw new EvidenceRejected("evidence carries a field that must not be public", key);
    }
  }

  for (const shape of SECRET_SHAPES) {
    const hit = json.match(shape);
    if (!hit) continue;
    // assetHash and txHash are 32-byte hashes by design; everything else
    // matching that shape is unaccounted for.
    const allowed = new RegExp(`"(assetHash|txHash)"\\s*:\\s*"${hit[0]}"`).test(json);
    if (!allowed) {
      throw new EvidenceRejected(`evidence contains something shaped like a secret or an identifier: ${hit[0]}`);
    }
  }
}

/** The exact bytes submitted to the topic. */
export function serialiseEvidence(record: EvidenceRecord): string {
  assertPublishable(record);
  return JSON.stringify(record);
}
