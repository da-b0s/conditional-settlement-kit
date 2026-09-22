/**
 * The invariants must point at tests that exist.
 *
 * invariants.ts is rendered on the home page and quoted in the README, so a
 * stale `testFile` is a claim the project makes and cannot back. It had one:
 * I6 named `I6_evidence_shape.t.ts`, which had never existed, and the home
 * page rendered it under a hardcoded `packages/hardhat/test/` prefix that was
 * wrong for it anyway — I6's proof is a unit suite, not a contract test.
 *
 * This is the check that stops that happening again.
 */
import { ALLOWED_TRANSITIONS, INVARIANTS, TERMINAL_STATES, canTransition, invariant } from "./invariants";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** This file lives at packages/nextjs/lib/settlement, so the root is four up. */
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

describe("every invariant points at a test that exists", () => {
  it.each(INVARIANTS.map(i => [i.id, i.testFile]))("%s -> %s", (_id, testFile) => {
    expect(existsSync(resolve(REPO_ROOT, testFile)), `${testFile} does not exist`).toBe(true);
  });

  it("names a path from the repository root, not a bare filename", () => {
    // A bare filename forces the UI to guess a prefix, which is how the I6
    // link broke in the first place.
    for (const inv of INVARIANTS) {
      expect(inv.testFile, `${inv.id}`).toMatch(/^packages\//);
    }
  });

  it("covers I1 through I6 exactly once each", () => {
    expect(INVARIANTS.map(i => i.id)).toEqual(["I1", "I2", "I3", "I4", "I5", "I6"]);
  });

  it("states a guarantee and how it is proven, for every one", () => {
    for (const inv of INVARIANTS) {
      expect(inv.statement.length, `${inv.id} statement`).toBeGreaterThan(20);
      expect(inv.provenBy.length, `${inv.id} provenBy`).toBeGreaterThan(20);
    }
  });
});

describe("the state machine", () => {
  it("makes settled and refunded terminal", () => {
    for (const state of TERMINAL_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).toEqual([]);
    }
  });

  it("I5: settled and refunded are unreachable from one another", () => {
    expect(canTransition("settled", "refunded")).toBe(false);
    expect(canTransition("refunded", "settled")).toBe(false);
  });

  it("allows only the documented path to each terminal state", () => {
    expect(canTransition("triggered", "settled")).toBe(true);
    expect(canTransition("expired", "refunded")).toBe(true);
    expect(canTransition("active", "settled")).toBe(false);
    expect(canTransition("draft", "triggered")).toBe(false);
  });

  it("refuses to look up an invariant that does not exist", () => {
    // A silent undefined would let a test claim to cover something imaginary.
    expect(() => invariant("I9" as never)).toThrow(/Unknown invariant/);
  });
});
