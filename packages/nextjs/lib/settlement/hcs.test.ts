/**
 * The read half of the evidence trail, tested offline.
 *
 * These use a fake fetch rather than the live mirror node, so they run on a
 * machine with no network and no credentials — the same property the module
 * itself is built for. The live read against a real topic is in the
 * integration suite.
 *
 * The interesting cases are all the ones where the mirror node hands back
 * something other than what we hoped for, because that is what an audit trail
 * has to survive to be worth anything.
 */
import { buildEvidence, serialiseEvidence } from "./evidence";
import { TopicReadFailed, findGaps, parseEvidence, readEvidence, topicUrl, trailForPolicy } from "./hcs";
import { describe, expect, it } from "vitest";

const ASSET = "0x" + "ab".repeat(32);

const encode = (text: string) => Buffer.from(text, "utf8").toString("base64");

function message(sequenceNumber: number, body: string) {
  return {
    consensus_timestamp: `${1_789_000_000 + sequenceNumber}.000000000`,
    sequence_number: sequenceNumber,
    message: encode(body),
  };
}

/** A fetch that serves the given pages in order. */
function fakeFetch(pages: unknown[], status = 200) {
  let call = 0;
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    const body = pages[Math.min(call++, pages.length - 1)];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const record = (policyId: number, kind: Parameters<typeof buildEvidence>[0]["kind"] = "settled") =>
  serialiseEvidence(buildEvidence({ kind, policyId, at: 1_789_000_000, assetHash: ASSET }));

describe("reading a topic", () => {
  it("decodes base64 messages into evidence records", async () => {
    const { impl } = fakeFetch([{ messages: [message(1, record(7))], links: { next: null } }]);
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });

    expect(trail.entries).toHaveLength(1);
    expect(trail.entries[0].record?.policyId).toBe(7);
    expect(trail.unreadable).toBe(0);
  });

  it("follows links.next without doubling the /api/v1 prefix", async () => {
    // The mirror node returns next already prefixed. Appending it to a base
    // that also carries the prefix produces /api/v1/api/v1 and a 404 — the
    // exact bug that silently truncates a trail to its first page.
    const { impl, calls } = fakeFetch([
      {
        messages: [message(1, record(1))],
        links: { next: "/api/v1/topics/0.0.5005/messages?limit=100&timestamp=gt:1" },
      },
      { messages: [message(2, record(2))], links: { next: null } },
    ]);
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });

    expect(trail.entries).toHaveLength(2);
    for (const url of calls) expect(url).not.toContain("/api/v1/api/v1");
  });

  it("stops at the page budget rather than paging forever", async () => {
    // A topic whose links.next never goes null would otherwise hang a render.
    const { impl, calls } = fakeFetch([
      { messages: [message(1, record(1))], links: { next: "/api/v1/topics/0.0.5005/messages?page=next" } },
    ]);
    await readEvidence("0.0.5005", { fetchImpl: impl, maxPages: 3 });
    expect(calls).toHaveLength(3);
  });

  it("publishes the URL it used, so the claim is checkable", async () => {
    // fakeFetch answers 200 to every URL, including the existence probe that
    // an empty result triggers, so this reads as a real but empty topic.
    const { impl } = fakeFetch([{ messages: [], links: { next: null } }]);
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });
    expect(trail.source).toBe(topicUrl("0.0.5005", "testnet"));
    expect(trail.source).toContain("testnet.mirrornode.hedera.com");
  });
});

describe("an empty topic versus a topic that does not exist", () => {
  /**
   * The messages endpoint answers 200 with an empty list for BOTH, so the two
   * are indistinguishable from that call alone. Getting this wrong makes the
   * audit page say "this topic exists and has no messages" about a typo — i.e.
   * report that a settlement produced no evidence when the real answer is
   * that you are looking at the wrong topic.
   */
  function routedFetch(routes: { messages: unknown; topicStatus: number }) {
    const seen: string[] = [];
    const impl = (async (url: string) => {
      const href = String(url);
      seen.push(href);
      if (href.includes("/messages")) {
        return { ok: true, status: 200, json: async () => routes.messages } as unknown as Response;
      }
      return {
        ok: routes.topicStatus < 400,
        status: routes.topicStatus,
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, seen };
  }

  it("reports a genuinely empty topic as empty", async () => {
    const { impl } = routedFetch({ messages: { messages: [], links: { next: null } }, topicStatus: 200 });
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });
    expect(trail.entries).toHaveLength(0);
  });

  it("reports a topic that does not exist as missing, not as empty", async () => {
    const { impl } = routedFetch({ messages: { messages: [], links: { next: null } }, topicStatus: 404 });
    await expect(readEvidence("0.0.5005", { fetchImpl: impl })).rejects.toThrow(/does not exist on testnet/);
  });

  it("does not pay for the existence check when messages came back", async () => {
    // The common path stays one request per page. Probing every read would
    // double the traffic to a public endpoint for no benefit.
    const { impl, seen } = routedFetch({
      messages: { messages: [message(1, record(1))], links: { next: null } },
      topicStatus: 404,
    });
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });
    expect(trail.entries).toHaveLength(1);
    expect(seen.filter(u => !u.includes("/messages"))).toHaveLength(0);
  });
});

describe("what it refuses to pretend about", () => {
  it("counts unreadable messages instead of dropping them", async () => {
    // Silently filtering these would make a corrupted trail look complete.
    const { impl } = fakeFetch([
      { messages: [message(1, record(1)), message(2, "not json at all")], links: { next: null } },
    ]);
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });

    expect(trail.entries).toHaveLength(2);
    expect(trail.unreadable).toBe(1);
    expect(trail.entries[1].unparsed?.reason).toBe("not JSON");
  });

  it("truncates an unparsed body rather than carrying it whole", async () => {
    const { impl } = fakeFetch([{ messages: [message(1, "x".repeat(10_000))], links: { next: null } }]);
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });
    expect(trail.entries[0].unparsed!.raw).toHaveLength(200);
  });

  it("reports sequence gaps", async () => {
    const { impl } = fakeFetch([{ messages: [message(1, record(1)), message(4, record(4))], links: { next: null } }]);
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });
    expect(trail.gaps).toEqual([2, 3]);
  });

  it("names a missing topic instead of returning an empty trail", async () => {
    const { impl } = fakeFetch([{}], 404);
    await expect(readEvidence("0.0.5005", { fetchImpl: impl })).rejects.toThrow(/does not exist on testnet/);
  });

  it("surfaces a mirror node failure rather than swallowing it", async () => {
    const { impl } = fakeFetch([{}], 503);
    await expect(readEvidence("0.0.5005", { fetchImpl: impl })).rejects.toThrow(TopicReadFailed);
  });

  it("rejects a topic id that is not a topic id", async () => {
    const { impl } = fakeFetch([{ messages: [], links: { next: null } }]);
    await expect(readEvidence("not-an-id", { fetchImpl: impl })).rejects.toThrow(/expected 0\.0\.x/);
  });
});

describe("parsing one message", () => {
  it("accepts a record this code wrote", () => {
    expect(parseEvidence(record(3))).toHaveProperty("record");
  });

  it.each([
    ["not JSON", "{oops"],
    ["not an object", "42"],
    ["unknown schema version 2", JSON.stringify({ v: 2, kind: "settled", policyId: 1, at: 1, assetHash: ASSET })],
    ['unknown kind "exploded"', JSON.stringify({ v: 1, kind: "exploded", policyId: 1, at: 1, assetHash: ASSET })],
    ["policyId is not an integer", JSON.stringify({ v: 1, kind: "settled", policyId: "1", at: 1, assetHash: ASSET })],
    [
      "assetHash is not a 32-byte hex hash",
      JSON.stringify({ v: 1, kind: "settled", policyId: 1, at: 1, assetHash: "HBAR/USD" }),
    ],
  ])("refuses %s", (reason, body) => {
    const outcome = parseEvidence(body);
    expect(outcome).toEqual({ reason });
  });

  it("will not guess at a schema it does not know", () => {
    // A future v2 record must not be read as a v1 one with fields missing.
    const v2 = JSON.stringify({ v: 2, kind: "settled", policyId: 1, at: 1, assetHash: ASSET, extra: true });
    expect(parseEvidence(v2)).not.toHaveProperty("record");
  });
});

describe("one policy's lifecycle", () => {
  it("returns only that policy's records, in the order read", async () => {
    const { impl } = fakeFetch([
      {
        messages: [
          message(1, record(1, "policy_created")),
          message(2, record(2, "policy_created")),
          message(3, record(1, "triggered")),
          message(4, record(1, "settled")),
        ],
        links: { next: null },
      },
    ]);
    const trail = await readEvidence("0.0.5005", { fetchImpl: impl });
    expect(trailForPolicy(trail, 1).map(r => r.kind)).toEqual(["policy_created", "triggered", "settled"]);
  });
});

describe("findGaps", () => {
  it("is empty for a contiguous run and for nothing at all", () => {
    expect(findGaps([1, 2, 3])).toEqual([]);
    expect(findGaps([])).toEqual([]);
    expect(findGaps([7])).toEqual([]);
  });

  it("does not report a gap below the first sequence number seen", () => {
    // Reading from the middle of a topic is normal, not a hole.
    expect(findGaps([50, 51])).toEqual([]);
  });
});
