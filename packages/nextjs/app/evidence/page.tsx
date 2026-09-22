import type { Metadata } from "next";
import { ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { type EvidenceTrail, readEvidence, topicUrl, trailForPolicy } from "~~/lib/settlement/hcs";
import { ALLOWED_TRANSITIONS, type PolicyState } from "~~/lib/settlement/invariants";

export const metadata: Metadata = {
  title: "Evidence · Conditional Settlement Kit",
  description:
    "Read a settlement's public evidence trail back from the Hedera mirror node. No wallet, no key, no permission.",
};

/**
 * The audit page.
 *
 * A Server Component with a plain GET form. No client JavaScript is needed
 * to read a public topic, and requiring a wallet to audit a settlement would
 * defeat the reason the evidence is public in the first place — the person
 * who most needs to check it is the counterparty, who has no access to
 * anything of yours.
 *
 * Deliberately not cached: an auditor pressing reload wants the current
 * state of the topic, not a copy from a minute ago.
 */
export const dynamic = "force-dynamic";

/** Evidence kinds map onto policy states, so a trail can be checked against the machine. */
const KIND_TO_STATE: Record<string, PolicyState> = {
  policy_created: "draft",
  triggered: "triggered",
  settled: "settled",
  expired: "expired",
  refunded: "refunded",
};

export default async function EvidencePage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  // A deployment can name its own topic, so /evidence opens on something
  // useful rather than an empty field. An explicit ?topic= still wins —
  // auditing someone else's settlement is the normal case, not the exception.
  const topicId = topic?.trim() || process.env.NEXT_PUBLIC_EVIDENCE_TOPIC?.trim() || undefined;

  let trail: EvidenceTrail | null = null;
  let error: string | null = null;

  if (topicId) {
    try {
      trail = await readEvidence(topicId, { network: "testnet" });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Evidence trail</h1>
        <p className="mt-2 max-w-2xl text-base-content/70">
          Every state change this kit makes is written to a Hedera consensus topic. Reading one back takes an HTTP
          request and nothing else — no wallet, no key, no permission. That is the point of putting it there: the person
          who most needs to audit a settlement is the counterparty, who has access to none of your systems.
        </p>
      </header>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-box border border-base-300 p-4">
        <label className="form-control grow">
          <span className="label-text mb-1">Topic ID</span>
          <input
            type="text"
            name="topic"
            defaultValue={topicId ?? ""}
            placeholder="0.0.12345"
            pattern="[0-9]+\.[0-9]+\.[0-9]+"
            className="input input-bordered w-full font-mono"
            aria-describedby="topic-help"
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Read the trail
        </button>
        <p id="topic-help" className="w-full text-xs text-base-content/60">
          Any topic on Hedera testnet. Messages that are not evidence records are listed as unreadable rather than
          hidden.
        </p>
      </form>

      {error && (
        <div role="alert" className="alert alert-error mt-6">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!topicId && !error && (
        <div role="note" className="alert mt-6">
          <InformationCircleIcon className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Enter a topic to read.</p>
            <p className="text-sm">
              Create one with <span className="font-mono text-xs">yarn evidence:topic</span>, or paste any testnet topic
              id to see how an unfamiliar one is handled.
            </p>
          </div>
        </div>
      )}

      {trail && <Trail trail={trail} />}
    </div>
  );
}

/**
 * How many unparseable messages to actually show.
 *
 * Found by pointing this page at a real stranger's topic: it returned a
 * thousand NAT-telemetry messages, all correctly refused, and rendered every
 * one of them. The refusal was right and the page was useless. An auditor
 * needs to know how many there were and what they look like, not to scroll
 * past a thousand of them to reach the records that matter.
 */
const UNREADABLE_SHOWN = 3;

function Trail({ trail }: { trail: EvidenceTrail }) {
  const policyIds = Array.from(
    new Set(trail.entries.map(e => e.record?.policyId).filter((id): id is number => id !== undefined)),
  ).sort((a, b) => a - b);

  // Readable records are the audit; show all of them. Unreadable ones are
  // context; show a few and say how many were left out.
  const readable = trail.entries.filter(e => e.record);
  const unreadable = trail.entries.filter(e => e.unparsed);
  const shownUnreadable = unreadable.slice(0, UNREADABLE_SHOWN);

  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">
          {trail.entries.length} message{trail.entries.length === 1 ? "" : "s"} on{" "}
          <span className="font-mono">{trail.topicId}</span>
        </h2>
        <a href={topicUrl(trail.topicId, trail.network)} target="_blank" rel="noreferrer" className="link text-sm">
          read it yourself on the mirror node →
        </a>
      </div>

      {/* Problems first. A trail with holes must not look complete. */}
      {(trail.unreadable > 0 || trail.gaps.length > 0) && (
        <div role="alert" className="alert alert-warning mb-4">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <div className="text-sm">
            {trail.unreadable > 0 && (
              <p>
                <span className="font-semibold">{trail.unreadable}</span> of {trail.entries.length} message
                {trail.entries.length === 1 ? "" : "s"} could not be read as evidence. They are counted below rather
                than filtered out — a trail that hides what it could not parse is not an audit.
              </p>
            )}
            {trail.gaps.length > 0 && (
              <p className="mt-1">
                Sequence numbers missing: <span className="font-mono">{trail.gaps.join(", ")}</span>. Messages exist
                that this read did not return.
              </p>
            )}
          </div>
        </div>
      )}

      {trail.entries.length === 0 && (
        <p className="rounded-box border border-base-300 p-6 text-center text-base-content/60">
          This topic exists and has no messages.
        </p>
      )}

      {readable.length > 0 && (
        <ol className="space-y-2">
          {readable.map(entry => (
            <li
              key={`${entry.sequenceNumber}-${entry.consensusTimestamp}`}
              className="rounded-box border border-base-300 p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-base-content/50">#{entry.sequenceNumber}</span>
                <span className="badge badge-primary badge-sm">{entry.record!.kind}</span>
                <span className="text-xs text-base-content/50">{consensusToIso(entry.consensusTimestamp)}</span>
              </div>

              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-base-content/60">policy</dt>
                <dd className="font-mono">{entry.record!.policyId}</dd>
                <dt className="text-base-content/60">asset</dt>
                <dd className="truncate font-mono text-xs">{entry.record!.assetHash}</dd>
                {entry.record!.price !== undefined && (
                  <>
                    <dt className="text-base-content/60">price (18dp)</dt>
                    <dd className="font-mono">{entry.record!.price}</dd>
                  </>
                )}
                {entry.record!.observedAt !== undefined && (
                  <>
                    <dt className="text-base-content/60">feed updated</dt>
                    <dd>{new Date(entry.record!.observedAt * 1000).toISOString()}</dd>
                  </>
                )}
                {entry.record!.txHash && (
                  <>
                    <dt className="text-base-content/60">tx</dt>
                    <dd className="truncate font-mono text-xs">{entry.record!.txHash}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ol>
      )}

      {unreadable.length > 0 && (
        <details className="mt-4 rounded-box border border-base-300 p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {unreadable.length} message{unreadable.length === 1 ? "" : "s"} that{" "}
            {unreadable.length === 1 ? "is" : "are"} not evidence
            {unreadable.length > UNREADABLE_SHOWN && ` — showing the first ${UNREADABLE_SHOWN}`}
          </summary>
          <p className="mt-2 text-sm text-base-content/70">
            Anyone holding a topic&apos;s submit key can write anything to it, and a topic created without one accepts
            messages from anybody. These are counted rather than hidden so the trail cannot look cleaner than it is.
          </p>
          <ol className="mt-3 space-y-2">
            {shownUnreadable.map(entry => (
              <li key={`${entry.sequenceNumber}-${entry.consensusTimestamp}`} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-xs text-base-content/50">#{entry.sequenceNumber}</span>
                  <span className="badge badge-warning badge-sm">{entry.unparsed!.reason}</span>
                  <span className="text-xs text-base-content/50">{consensusToIso(entry.consensusTimestamp)}</span>
                </div>
                <pre className="mt-1 overflow-x-auto rounded bg-base-200 p-2 text-xs">{entry.unparsed!.raw}</pre>
              </li>
            ))}
          </ol>
        </details>
      )}

      {policyIds.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold">Lifecycles</h3>
          <p className="mt-1 text-sm text-base-content/70">
            Each policy&apos;s records in consensus order, checked against the state machine. A sequence the machine
            does not allow is flagged — that is what makes this an audit rather than a log.
          </p>
          <ul className="mt-3 space-y-2">
            {policyIds.map(id => (
              <Lifecycle key={id} policyId={id} trail={trail} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Lifecycle({ policyId, trail }: { policyId: number; trail: EvidenceTrail }) {
  const kinds = trailForPolicy(trail, policyId).map(r => r.kind);
  const problems = illegalSteps(kinds);

  return (
    <li className="rounded-box border border-base-300 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">policy {policyId}</span>
        {kinds.map((kind, index) => (
          <span key={`${kind}-${index}`} className="flex items-center gap-2">
            {index > 0 && <span className="text-base-content/30">→</span>}
            <span className="badge badge-sm badge-outline">{kind}</span>
          </span>
        ))}
      </div>
      {problems.length > 0 ? (
        <p className="mt-2 text-sm text-error">
          Not a legal sequence: {problems.join("; ")}. Either a message is missing from this read, or something wrote to
          this topic that the contracts did not.
        </p>
      ) : (
        <p className="mt-2 text-sm text-success">Consistent with the state machine.</p>
      )}
    </li>
  );
}

/** Steps this sequence takes that ALLOWED_TRANSITIONS does not permit. */
function illegalSteps(kinds: string[]): string[] {
  const problems: string[] = [];
  for (let i = 1; i < kinds.length; i++) {
    const from = KIND_TO_STATE[kinds[i - 1]];
    const to = KIND_TO_STATE[kinds[i]];
    if (!from || !to) continue;
    // A policy goes draft -> active -> triggered, but nothing is written to
    // the topic on funding, so draft -> triggered is the expected shape.
    const reachable = from === "draft" ? ["active", "triggered", "expired"] : ALLOWED_TRANSITIONS[from];
    if (!reachable.includes(to)) problems.push(`${kinds[i - 1]} cannot be followed by ${kinds[i]}`);
  }
  return problems;
}

/** `1789000000.000000000` → an ISO string. */
function consensusToIso(consensusTimestamp: string): string {
  const seconds = Number(consensusTimestamp.split(".")[0]);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : consensusTimestamp;
}
