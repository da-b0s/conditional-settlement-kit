import Link from "next/link";
import type { Metadata } from "next";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { RetryRead } from "~~/components/RetryRead";
import { DEFAULT_RPC, formatAge, formatAnswer, readLiveFeeds } from "~~/lib/settlement/feedReader";
import { DECLARED_HEARTBEAT_SECONDS, TESTNET_FEEDS } from "~~/lib/settlement/feeds";

export const metadata: Metadata = {
  title: "Live prices",
  description:
    "Every Chainlink feed on Hedera testnet, read live, with the age each one is actually reporting against the bound this template enforces.",
};

/**
 * The live feeds page.
 *
 * A Server Component, deliberately: it reads the feeds on the server with
 * `fetch` and renders HTML. No wallet, no `.env`, no client bundle, nothing
 * asked of the visitor. Someone evaluating this template can check its
 * central claim before deciding whether to trust it with anything.
 *
 * Read on request so a retry cannot serve a cached outage. Requests have a
 * deadline and partial results remain visible when only some feeds fail.
 */
export const dynamic = "force-dynamic";

const HOUR = 3600;

export default async function FeedsPage() {
  const report = await readLiveFeeds({ rpcUrl: DEFAULT_RPC.testnet }).catch(error => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!("error" in report) && report.feeds.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold">Live feeds</h1>
        <div role="alert" className="alert alert-warning mt-6">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Live prices are unavailable right now.</p>
            <p>The network may be slow or unavailable. The feed configuration is shown below.</p>
            <RetryRead />
          </div>
        </div>
        <StaticTable />
      </div>
    );
  }

  // The whole endpoint failed. Say so plainly rather than rendering an empty
  // table that looks like "there are no feeds".
  if ("error" in report) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <h1 className="text-3xl font-bold">Live feeds</h1>
        <div role="alert" className="alert alert-warning mt-6">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Could not reach the Hedera testnet RPC endpoint.</p>
            <p className="text-sm">
              {report.error}. The feed addresses and bounds below are still what this template would enforce — only the
              live reading is missing.
            </p>
            <RetryRead />
          </div>
        </div>
        <StaticTable />
      </div>
    );
  }

  const rejectedByTightBound = report.wronglyRejectedByTightGlobalBound;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Live feeds</h1>
        <p className="mt-2 max-w-3xl text-base-content/70">
          Every Chainlink price feed on Hedera testnet, read from the chain when this page was rendered. No wallet and
          no credentials were involved — this is a JSON-RPC call from the server.
        </p>
      </header>

      {/* The argument, stated from the numbers actually on screen. */}
      <section className="mb-8 rounded-box border border-base-300 bg-base-200/40 p-5">
        <h2 className="text-lg font-semibold">Why each feed carries its own staleness bound</h2>
        <p className="mt-2 text-sm text-base-content/80">
          All {report.feeds.length} feeds declare the same {DECLARED_HEARTBEAT_SECONDS.toLocaleString()}-second
          heartbeat, so every reading below is &ldquo;within spec&rdquo;. Right now the oldest is{" "}
          <span className="font-semibold">{report.spread ? `${report.spread.toFixed(0)}×` : "many times"}</span> the age
          of the freshest.
        </p>
        {rejectedByTightBound.length > 0 ? (
          <p className="mt-3 text-sm text-base-content/80">
            A single one-hour bound applied to everything would reject{" "}
            <span className="font-semibold">{rejectedByTightBound.join(", ")}</span> right now — healthy{" "}
            {rejectedByTightBound.length === 1 ? "feed, behaving" : "feeds, each behaving"} exactly as designed. A
            single 24-hour bound would instead accept an HBAR/USD price a full day old and settle a payout on it.
            Neither is safe, which is why the bound is stored per feed with no global default.
          </p>
        ) : (
          <p className="mt-3 text-sm text-base-content/80">
            At this moment every feed happens to be fresh enough that even a one-hour global bound would pass them all.
            That is luck, not design — reload in an hour. The stablecoin feeds routinely sit past sixteen hours while
            staying entirely in spec.
          </p>
        )}
      </section>

      <div className="overflow-x-auto rounded-box border border-base-300">
        <table className="table table-zebra">
          <thead>
            <tr>
              <th>Pair</th>
              <th className="text-right">Price</th>
              <th className="text-right">Age</th>
              <th className="text-right">This template&apos;s bound</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {report.feeds.map(feed => (
              <tr key={feed.proxy}>
                <td>
                  <div className="font-semibold">{feed.pair}</div>
                  <div className="font-mono text-xs text-base-content/50">{feed.proxy}</div>
                </td>
                <td className="text-right font-mono">
                  {formatAnswer(feed.answer, feed.decimals)}
                  <div className="text-xs text-base-content/50">{feed.decimals} decimals</div>
                </td>
                <td className="text-right">{formatAge(feed.ageSeconds)}</td>
                <td className="text-right">{feed.boundSeconds / HOUR} hours</td>
                <td>
                  {feed.withinBound ? (
                    <span className="badge badge-success badge-sm">fresh</span>
                  ) : (
                    <span className="badge badge-error badge-sm">would revert</span>
                  )}
                  {feed.withinBound && !feed.withinGlobalTightBound && (
                    <div className="mt-1 text-xs text-warning">a 1h global bound would reject this</div>
                  )}
                  {feed.carriedOver && (
                    <div className="mt-1 text-xs text-error">answer carried over from an older round</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.failures.length > 0 && (
        <div role="alert" className="alert alert-warning mt-6">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {report.failures.length} of {TESTNET_FEEDS.length} feeds could not be read.
            </p>
            <ul className="mt-1 text-sm">
              {report.failures.map(failure => (
                <li key={failure.proxy}>
                  <span className="font-semibold">{failure.pair}</span> — {failure.reason}
                </li>
              ))}
            </ul>
            <RetryRead />
          </div>
        </div>
      )}

      <footer className="mt-6 space-y-1 text-xs text-base-content/60">
        <p>
          Read from <span className="font-mono">{report.rpcUrl}</span> at {new Date(report.readAt * 1000).toISOString()}
          . Read when this page was requested.
        </p>
        <p>
          The same measurement runs as a test: <span className="font-mono">yarn test:live</span>. It asserts the shape
          of this finding rather than the exact numbers, because the numbers move and the finding does not.
        </p>
        <p>
          <Link href="/policies" className="link link-hover text-primary">
            Create a policy against one of these feeds →
          </Link>
        </p>
      </footer>
    </div>
  );
}

/** Shown when the live read failed. The configuration is still worth seeing. */
function StaticTable() {
  return (
    <div className="mt-6 overflow-x-auto rounded-box border border-base-300">
      <table className="table table-zebra">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Proxy</th>
            <th className="text-right">Bound this template enforces</th>
          </tr>
        </thead>
        <tbody>
          {TESTNET_FEEDS.map(feed => (
            <tr key={feed.proxy}>
              <td className="font-semibold">{feed.pair}</td>
              <td className="font-mono text-xs">{feed.proxy}</td>
              <td className="text-right">{feed.recommendedMaxAgeSeconds / HOUR} hours</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
