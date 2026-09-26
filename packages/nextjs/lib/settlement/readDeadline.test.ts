import { readLiveFeeds } from "./feedReader";
import { TESTNET_FEEDS } from "./feeds";
import { readEvidence } from "./hcs";
import { withReadDeadline } from "./readDeadline";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.useRealTimers());

describe("bounded network reads", () => {
  it("aborts a stalled read and returns a useful error", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const read = withReadDeadline(s => {
      signal = s;
      return new Promise(() => {});
    });
    const result = expect(read).rejects.toThrow("Please try again");
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline after success or failure", async () => {
    vi.useFakeTimers();
    expect(await withReadDeadline(async () => 42)).toBe(42);
    await expect(
      withReadDeadline(async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds stalled feed response bodies and reports each failed feed", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) })) as unknown as typeof fetch;
    const read = readLiveFeeds({ fetchImpl });
    await vi.advanceTimersByTimeAsync(15_000);
    const report = await read;
    expect(report.feeds).toHaveLength(0);
    expect(report.failures).toHaveLength(7);
    expect(report.failures.every(f => f.reason.includes("Please try again"))).toBe(true);
  });

  it("uses one deadline across evidence pagination, including response bodies", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        return { ok: true, json: async () => ({ messages: [], links: { next: "/api/v1/next" } }) };
      }
      return { ok: true, json: () => new Promise(() => {}) };
    }) as unknown as typeof fetch;
    const result = expect(readEvidence("0.0.123", { fetchImpl })).rejects.toThrow("Please try again");
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(calls).toBe(2);
  });

  it("keeps a healthy feed when another feed times out", async () => {
    vi.useFakeTimers();
    const now = 1_790_000_000;
    const word = (value: number) => value.toString(16).padStart(64, "0");
    const fetchImpl = (async (_url, init) => {
      const { params } = JSON.parse(String(init?.body));
      if (params[0].to === TESTNET_FEEDS[1].proxy) return new Promise(() => {});
      const result =
        params[0].data === "0x313ce567" ? `0x${word(8)}` : `0x${[1, 10_000_000, now, now, 1].map(word).join("")}`;
      return { ok: true, json: async () => ({ result }) } as Response;
    }) as typeof fetch;
    const read = readLiveFeeds({ fetchImpl, now, feeds: TESTNET_FEEDS.slice(0, 2) });
    await vi.advanceTimersByTimeAsync(15_000);
    const report = await read;
    expect(report.feeds).toHaveLength(1);
    expect(report.feeds[0].pair).toBe(TESTNET_FEEDS[0].pair);
    expect(report.failures).toHaveLength(1);
  });
});
