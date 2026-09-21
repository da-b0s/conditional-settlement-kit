/**
 * The scheduling guards, and the read path, offline.
 *
 * `scheduleExpiry` itself is not tested here: it costs HBAR and needs an
 * operator, so it belongs in the integration suite. What IS tested here is
 * everything it refuses to attempt, because those are the cases that would
 * otherwise cost money to discover — and the error translation, because a
 * scheduling failure a user cannot read is a scheduling failure they will
 * assume means their escrow is gone.
 */
import { MAX_SCHEDULE_SECONDS, ScheduleFailed, describeScheduleError, scheduleExpiry, scheduleFate } from "./schedule";
import { describe, expect, it } from "vitest";

const OPERATOR = { accountId: "0.0.1001", privateKey: "0x" + "11".repeat(32), network: "testnet" as const };
const REGISTRY = "0x" + "ab".repeat(20);

const soon = () => Math.floor(Date.now() / 1000) + 3600;

function fakeFetch(body: unknown, status = 200) {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("what it refuses before spending anything", () => {
  it("will not schedule a deadline that has already passed", async () => {
    // The right advice here is not "try again" — it is "just call expire()".
    await expect(
      scheduleExpiry(OPERATOR, { registryEvmAddress: REGISTRY, policyId: 1, deadline: 1_000 }),
    ).rejects.toThrow(/call expire\(\) directly/);
  });

  it("will not schedule beyond the HIP-423 limit, and says how far over", async () => {
    const tooFar = Math.floor(Date.now() / 1000) + MAX_SCHEDULE_SECONDS + 86_400;
    await expect(
      scheduleExpiry(OPERATOR, { registryEvmAddress: REGISTRY, policyId: 1, deadline: tooFar }),
    ).rejects.toThrow(/caps it at 62/);
  });

  it("rejects a registry address that is not an address", async () => {
    await expect(
      scheduleExpiry(OPERATOR, { registryEvmAddress: "0.0.4242", policyId: 1, deadline: soon() }),
    ).rejects.toThrow(/not an EVM address/);
  });

  it("rejects a nonsense policy id", async () => {
    await expect(
      scheduleExpiry(OPERATOR, { registryEvmAddress: REGISTRY, policyId: -1, deadline: soon() }),
    ).rejects.toThrow(ScheduleFailed);
  });
});

describe("reading a schedule's fate without credentials", () => {
  it("reports a schedule that has executed", async () => {
    const fate = await scheduleFate("0.0.7007", {
      fetchImpl: fakeFetch({ executed_timestamp: "1789000000.000000000", deleted: false }),
    });
    expect(fate!.executedAt).toBe("1789000000.000000000");
    expect(fate!.deleted).toBe(false);
  });

  it("reports one still waiting", async () => {
    const fate = await scheduleFate("0.0.7007", {
      fetchImpl: fakeFetch({ executed_timestamp: null, deleted: false, expiration_time: "1789003600.000000000" }),
    });
    expect(fate!.executedAt).toBeNull();
    expect(fate!.expirationTime).toBe("1789003600.000000000");
  });

  it("returns null for a schedule the mirror node has pruned", async () => {
    // A completed lifecycle must not look like a failure.
    expect(await scheduleFate("0.0.7007", { fetchImpl: fakeFetch({}, 404) })).toBeNull();
  });

  it("surfaces a mirror node failure rather than reporting 'not scheduled'", async () => {
    await expect(scheduleFate("0.0.7007", { fetchImpl: fakeFetch({}, 500) })).rejects.toThrow(/returned 500/);
  });

  it("publishes the URL it read", async () => {
    const fate = await scheduleFate("0.0.7007", { fetchImpl: fakeFetch({}) });
    expect(fate!.source).toBe("https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.7007");
  });

  it("rejects something that is not a schedule id", async () => {
    await expect(scheduleFate("nope", { fetchImpl: fakeFetch({}) })).rejects.toThrow(/expected 0\.0\.x/);
  });
});

describe("translating Hedera's statuses", () => {
  it("THE ONE THAT MATTERS: a whitelist refusal says the escrow is still safe", () => {
    // If this ever fires in the wild, the user's first question is "is my
    // money stuck". The answer must be in the message.
    const text = describeScheduleError(new Error("receipt for ... SCHEDULED_TRANSACTION_NOT_IN_WHITELIST"));
    expect(text).toMatch(/expire\(\) is permissionless/);
    expect(text).toMatch(/still expires/);
  });

  it("treats a duplicate schedule as the non-event it is", () => {
    expect(describeScheduleError(new Error("IDENTICAL_SCHEDULE_ALREADY_CREATED"))).toMatch(
      /will fire at the same time/,
    );
  });

  it.each([
    ["SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE", /62-day/],
    ["INSUFFICIENT_PAYER_BALANCE", /faucet/],
    ["INVALID_CONTRACT_ID", /check HEDERA_NETWORK/],
  ])("explains %s", (status, expected) => {
    expect(describeScheduleError(new Error(status))).toMatch(expected);
  });

  it("passes an unrecognised error through rather than flattening it", () => {
    // A generic "scheduling failed" would destroy the only diagnostic there is.
    expect(describeScheduleError(new Error("SOME_NEW_STATUS_42"))).toBe("SOME_NEW_STATUS_42");
  });
});
