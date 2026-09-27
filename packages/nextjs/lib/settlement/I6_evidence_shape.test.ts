/**
 * I6 — Public evidence contains no secrets or personal data.
 *
 * HCS topics are public and permanent. Anyone reads the whole history from
 * the mirror node with no key and no permission, forever. A field published
 * carelessly cannot be withdrawn; the best anyone can do is append a
 * correction underneath it.
 *
 * These tests run offline against the builder. The live half of I6 — reading
 * a real topic back from the mirror node and asserting on its shape — lives
 * in the integration suite, because it needs a topic to exist.
 *
 * The tests below are deliberately adversarial. They are not "does the happy
 * path serialise"; they are "here is a plausible mistake a future contributor
 * will make, does the builder stop it".
 */
import { EvidenceRejected, FORBIDDEN_KEYS, assertPublishable, buildEvidence, serialiseEvidence } from "./evidence";
import { describe, expect, it } from "vitest";

const ASSET = "0x" + "ab".repeat(32);
const TX = "0x" + "cd".repeat(32);

const base = { kind: "settled" as const, policyId: 7, at: 1_789_000_000, assetHash: ASSET };

describe("I6 — what reaches a public topic", () => {
  it("builds the minimal record", () => {
    const r = buildEvidence(base);
    expect(r.v).toBe(1);
    expect(r.kind).toBe("settled");
    expect(r.policyId).toBe(7);
    expect(r.assetHash).toBe(ASSET);
  });

  it("carries only the keys it declares", () => {
    const r = buildEvidence({ ...base, price: 89_100_000_000_000_000n, observedAt: 1_789_000_000, txHash: TX });
    expect(Object.keys(r).sort()).toEqual([
      "assetHash",
      "at",
      "kind",
      "observedAt",
      "policyId",
      "price",
      "txHash",
      "v",
    ]);
  });

  it("omits optional fields rather than writing null", () => {
    // A null on a public ledger is still a field, and still says something.
    const json = serialiseEvidence(buildEvidence(base));
    expect(json).not.toContain("null");
    expect(json).not.toContain("price");
    expect(json).not.toContain("txHash");
  });

  describe("THE INVARIANT: refuses anything that should not be public", () => {
    it("rejects an extra field smuggled in by a caller", () => {
      // The realistic failure: someone spreads a richer object into the
      // builder's input, and a beneficiary address rides along.
      const sneaky = { ...base, beneficiary: "0x" + "11".repeat(20) } as never;
      const r = buildEvidence(sneaky);
      // buildEvidence constructs field by field, so the extra never survives.
      expect(JSON.stringify(r)).not.toContain("beneficiary");
      expect(JSON.stringify(r)).not.toContain("1111");
    });

    it.each(FORBIDDEN_KEYS)("rejects a record carrying %s", key => {
      const tainted = { ...buildEvidence(base), [key]: "anything" };
      expect(() => assertPublishable(tainted)).toThrow(EvidenceRejected);
    });

    it("rejects an EVM address hidden in a value", () => {
      const tainted = { ...buildEvidence(base), kind: "settled to 0x" + "11".repeat(20) };
      expect(() => assertPublishable(tainted)).toThrow(/shaped like a secret/);
    });

    it("rejects a Hedera account id hidden in a value", () => {
      const tainted = { ...buildEvidence(base), kind: "paid 0.0.10474072" };
      expect(() => assertPublishable(tainted)).toThrow(/shaped like a secret/);
    });

    it("rejects an email address", () => {
      const tainted = { ...buildEvidence(base), kind: "claimant@example.com" };
      expect(() => assertPublishable(tainted)).toThrow(/shaped like a secret/);
    });

    it("rejects a raw private key even under an innocent name", () => {
      const tainted = { ...buildEvidence(base), reference: "a".repeat(64) };
      expect(() => assertPublishable(tainted)).toThrow(/shaped like a secret/);
    });

    it("rejects a 0x-prefixed key placed AFTER the legitimate assetHash", () => {
      // Regression: the guard used to check only the first match per shape.
      // assetHash always serialises first and is allowed, so a key after it
      // was never looked at.
      const tainted = { ...buildEvidence(base), reference: "0x" + "b".repeat(64) };
      expect(() => assertPublishable(tainted)).toThrow(/shaped like a secret/);
    });

    it("does not treat an address in assetHash as a permitted hash", () => {
      const tainted = { ...buildEvidence(base), assetHash: "0x" + "1".repeat(40) };
      expect(() => assertPublishable(tainted)).toThrow(/shaped like a secret/);
    });

    it("allows the two hashes that are supposed to be there", () => {
      // The guard must not be so blunt that it refuses the record's own
      // legitimate 32-byte fields.
      const r = buildEvidence({ ...base, txHash: TX });
      expect(() => assertPublishable(r)).not.toThrow();
    });
  });

  describe("inputs it will not accept", () => {
    it("refuses a readable asset name where a hash belongs", () => {
      // "HBAR/USD" today is a customer reference once someone generalises it.
      expect(() => buildEvidence({ ...base, assetHash: "HBAR/USD" })).toThrow(/must be a 32-byte hex hash/);
    });

    it("refuses a malformed txHash", () => {
      expect(() => buildEvidence({ ...base, txHash: "0xdeadbeef" })).toThrow(/txHash/);
    });

    it("refuses a negative or fractional policyId", () => {
      expect(() => buildEvidence({ ...base, policyId: -1 })).toThrow(/policyId/);
      expect(() => buildEvidence({ ...base, policyId: 1.5 })).toThrow(/policyId/);
    });
  });

  describe("shape stays stable", () => {
    it("serialises a bigint price as a decimal string, not scientific notation", () => {
      // JSON.stringify on a Number would give 8.91e+16 for large values, and
      // a reader parsing that back loses precision silently.
      const r = buildEvidence({ ...base, price: 89_100_000_000_000_000n });
      expect(r.price).toBe("89100000000000000");
      expect(serialiseEvidence(r)).toContain('"price":"89100000000000000"');
    });

    it("floors timestamps so a float never reaches the topic", () => {
      const r = buildEvidence({ ...base, at: 1_789_000_000.9, observedAt: 1_788_999_999.4 });
      expect(r.at).toBe(1_789_000_000);
      expect(r.observedAt).toBe(1_788_999_999);
    });

    it("every record declares its schema version", () => {
      for (const kind of ["policy_created", "triggered", "settled", "expired", "refunded"] as const) {
        expect(buildEvidence({ ...base, kind }).v).toBe(1);
      }
    });
  });
});
