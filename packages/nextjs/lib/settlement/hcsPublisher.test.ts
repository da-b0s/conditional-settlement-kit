/**
 * Key parsing, and the SDK behaviour that made it subtle.
 *
 * These matter because getting it wrong does not throw. It signs with a key
 * that is not yours, the network answers INVALID_SIGNATURE, and the error
 * looks like a permissions problem on an operation that has no permissions.
 */
import { PublishFailed, operatorFromEnv, parseOperatorKey } from "./hcsPublisher";
import { PrivateKey } from "@hiero-ledger/sdk";
import { describe, expect, it } from "vitest";

/** A real ECDSA testnet key shape. Value is irrelevant; the shape is the test. */
const RAW_ECDSA = "0x" + "11".repeat(32);
const BARE_ECDSA = "11".repeat(32);

describe("THE SDK QUIRK this code exists to work around", () => {
  it("fromStringDer ACCEPTS a raw ECDSA hex string instead of rejecting it", () => {
    // If this ever starts throwing, the try/catch approach would become
    // viable — and this test will fail, prompting someone to check.
    // Until then, a DER-first fallback chain silently never falls back.
    expect(() => PrivateKey.fromStringDer(BARE_ECDSA)).not.toThrow();
  });

  it("and the key it returns is NOT the one fromStringECDSA returns", () => {
    // This is the whole bug in one line: two different keys from one string,
    // and the wrong one is the one a DER-first chain picks.
    const viaDer = PrivateKey.fromStringDer(BARE_ECDSA).publicKey.toStringRaw();
    const viaEcdsa = PrivateKey.fromStringECDSA(BARE_ECDSA).publicKey.toStringRaw();
    expect(viaDer).not.toBe(viaEcdsa);
  });
});

describe("parseOperatorKey", () => {
  it("reads a raw 32-byte hex key as ECDSA, with or without 0x", () => {
    const withPrefix = parseOperatorKey(RAW_ECDSA, PrivateKey).publicKey.toStringRaw();
    const without = parseOperatorKey(BARE_ECDSA, PrivateKey).publicKey.toStringRaw();
    expect(withPrefix).toBe(without);
    expect(withPrefix).toBe(PrivateKey.fromStringECDSA(BARE_ECDSA).publicKey.toStringRaw());
  });

  it("reads it as ED25519 only when told to", () => {
    const asEd = parseOperatorKey(BARE_ECDSA, PrivateKey, "ed25519").publicKey.toStringRaw();
    expect(asEd).toBe(PrivateKey.fromStringED25519(BARE_ECDSA).publicKey.toStringRaw());
    expect(asEd).not.toBe(parseOperatorKey(BARE_ECDSA, PrivateKey).publicKey.toStringRaw());
  });

  it("defaults to ECDSA, because ED25519 cannot touch the EVM on Hedera", () => {
    for (const hint of [undefined, "", "ecdsa", "ECDSA", "anything-else"]) {
      expect(parseOperatorKey(BARE_ECDSA, PrivateKey, hint).publicKey.toStringRaw()).toBe(
        PrivateKey.fromStringECDSA(BARE_ECDSA).publicKey.toStringRaw(),
      );
    }
  });

  it("routes a DER-encoded key to the DER parser", () => {
    const der = PrivateKey.generateECDSA().toStringDer();
    expect(der.length).toBeGreaterThan(64);
    expect(parseOperatorKey(der, PrivateKey).publicKey.toStringRaw()).toBe(
      PrivateKey.fromStringDer(der).publicKey.toStringRaw(),
    );
  });

  it("rejects something that is not hex at all", () => {
    expect(() => parseOperatorKey("not-a-key", PrivateKey)).toThrow(/not hex/);
  });

  it("rejects a key that is too short, and says how short", () => {
    expect(() => parseOperatorKey("abcdef", PrivateKey)).toThrow(/6 hex characters/);
  });
});

describe("operatorFromEnv", () => {
  it("returns null when nothing is configured — the normal state here", () => {
    // Most of this template needs no operator, so absence must not throw.
    expect(operatorFromEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("names the half that is missing rather than failing vaguely", () => {
    expect(() => operatorFromEnv({ NODE_ENV: "test", HEDERA_OPERATOR_KEY: RAW_ECDSA } as NodeJS.ProcessEnv)).toThrow(
      /HEDERA_OPERATOR_ID is not/,
    );
    expect(() => operatorFromEnv({ NODE_ENV: "test", HEDERA_OPERATOR_ID: "0.0.1" } as NodeJS.ProcessEnv)).toThrow(
      /HEDERA_OPERATOR_KEY is not/,
    );
  });

  it("rejects an account id that is not one", () => {
    expect(() =>
      operatorFromEnv({
        NODE_ENV: "test",
        HEDERA_OPERATOR_ID: "0x1234",
        HEDERA_OPERATOR_KEY: RAW_ECDSA,
      } as NodeJS.ProcessEnv),
    ).toThrow(PublishFailed);
  });

  it("carries the key type hint through", () => {
    const op = operatorFromEnv({
      NODE_ENV: "test",
      HEDERA_OPERATOR_ID: "0.0.1",
      HEDERA_OPERATOR_KEY: RAW_ECDSA,
      HEDERA_KEY_TYPE: "ed25519",
    } as NodeJS.ProcessEnv);
    expect(op?.keyType).toBe("ed25519");
  });

  it("defaults to testnet and refuses an unknown network", () => {
    expect(
      operatorFromEnv({
        NODE_ENV: "test",
        HEDERA_OPERATOR_ID: "0.0.1",
        HEDERA_OPERATOR_KEY: RAW_ECDSA,
      } as NodeJS.ProcessEnv)?.network,
    ).toBe("testnet");
    expect(() =>
      operatorFromEnv({
        NODE_ENV: "test",
        HEDERA_OPERATOR_ID: "0.0.1",
        HEDERA_OPERATOR_KEY: RAW_ECDSA,
        HEDERA_NETWORK: "devnet",
      } as NodeJS.ProcessEnv),
    ).toThrow(/expected mainnet, testnet or previewnet/);
  });
});
