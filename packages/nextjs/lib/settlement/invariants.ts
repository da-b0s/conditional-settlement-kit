/**
 * The six invariants. This file is the product.
 *
 * ---------------------------------------------------------------------------
 * Everything else in this repository exists to uphold or demonstrate one of
 * these. They are written before the code on purpose: they become the tests
 * (one file per invariant, named after it), the acceptance contract the
 * harness grades, the demo script, and a README section — so a reader can map
 * guarantee to proof in seconds.
 *
 * The rule when changing this file: an invariant may be clarified, but it may
 * not be weakened to match an implementation that failed it. If the code
 * cannot hold the line, the code is wrong.
 * ---------------------------------------------------------------------------
 *
 * Framework-free. Nothing here imports React, Next.js, wagmi or ethers, so it
 * runs from a route handler, a script, a test, or another framework entirely.
 */

export type InvariantId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6";

export interface Invariant {
  id: InvariantId;
  /** What must always be true. Stated as a guarantee, not as a feature. */
  statement: string;
  /** The test that would catch it breaking. Names the failing direction. */
  provenBy: string;
  /**
   * The test file that holds it, as a path from the repository root.
   *
   * A full path rather than a bare filename because I6's proof does NOT live
   * beside the others: it is a unit suite against the evidence builder, not a
   * contract test. A shared prefix assumed by the UI produced a link to a
   * file that had never existed.
   */
  testFile: string;
}

export const INVARIANTS: readonly Invariant[] = [
  {
    id: "I1",
    statement:
      "A policy settles at most once. Repeated evidence, repeated clicks or a replayed observation cannot pay twice.",
    provenBy: "Call settle twice with the same observation; the second reverts.",
    testFile: "packages/hardhat/test/I1_settles_once.t.ts",
  },
  {
    id: "I2",
    statement:
      "A trigger must use an allowed provider and feed, satisfy that feed's own freshness bound, and match the policy's units and decimals.",
    provenBy: "Submit an observation older than that feed's bound; reverts. Submit from an unregistered feed; reverts.",
    testFile: "packages/hardhat/test/I2_freshness_and_feed.t.ts",
  },
  {
    id: "I3",
    statement: "Payout never exceeds funded escrow. Fees and rounding are bounded and documented.",
    provenBy: "Configure a payout larger than escrow; reverts.",
    testFile: "packages/hardhat/test/I3_payout_bounded.t.ts",
  },
  {
    id: "I4",
    statement: "Only authorised paths change final state. Emergency controls are explicit and test-covered.",
    provenBy: "Unauthorised caller attempts settle; reverts.",
    testFile: "packages/hardhat/test/I4_authorisation.t.ts",
  },
  {
    id: "I5",
    statement: "Expiry and settlement cannot both succeed. Both are terminal and mutually exclusive.",
    provenBy: "Race expiry-then-settle and settle-then-expiry; exactly one wins in each case.",
    testFile: "packages/hardhat/test/I5_expiry_race.t.ts",
  },
  {
    id: "I6",
    statement: "Public evidence contains no secrets or personal data — hashes and minimal summaries only.",
    provenBy:
      "Adversarial tests against the builder: every forbidden field, and every value shaped like an address, an account id or a key, is refused. Reading a real topic back exercises the same shape from the other side.",
    testFile: "packages/nextjs/lib/settlement/I6_evidence_shape.test.ts",
  },
] as const;

/**
 * The policy lifecycle.
 *
 *   draft --fund--> active --observation crosses threshold--> triggered
 *     |                                                          |
 *     |                                                        settle
 *     |                                                          v
 *     |                                                   settled (terminal)
 *     |
 *     +-- expiry reached (HSS scheduled call) --> expired --refund--> refunded (terminal)
 *
 * I5 is the reason `settled` and `refunded` are both terminal and unreachable
 * from one another.
 */
export type PolicyState = "draft" | "active" | "triggered" | "settled" | "expired" | "refunded";

/** States from which no transition is permitted. Asserted by I5's tests. */
export const TERMINAL_STATES: readonly PolicyState[] = ["settled", "refunded"] as const;

export function isTerminal(state: PolicyState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * The transitions the state machine allows. Anything absent here is a bug,
 * not an omission — I4 and I5 are enforced by this table being exhaustive.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<PolicyState, readonly PolicyState[]>> = {
  // Draft -> expired so the machine is total: a policy created and never
  // funded can still reach a terminal state. No escrow is involved, because
  // fund() reverts rather than leaving a Draft policy partially funded.
  draft: ["active", "expired"],
  active: ["triggered", "expired"],
  triggered: ["settled"],
  // Terminal. Listed explicitly so a reader does not have to infer it.
  settled: [],
  expired: ["refunded"],
  refunded: [],
} as const;

export function canTransition(from: PolicyState, to: PolicyState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function invariant(id: InvariantId): Invariant {
  const found = INVARIANTS.find(i => i.id === id);
  // Unreachable through the type system, but a lookup that silently returns
  // undefined would let a test claim to cover an invariant that does not exist.
  if (!found) throw new Error(`Unknown invariant ${id}`);
  return found;
}
