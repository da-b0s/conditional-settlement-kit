import Link from "next/link";
import { ArrowRightIcon, CheckBadgeIcon } from "@heroicons/react/24/outline";
import { INVARIANTS } from "~~/lib/settlement/invariants";

/**
 * The landing page.
 *
 * A Server Component with no client JavaScript and no wallet prompt. A
 * visitor should be able to understand what this is and check its central
 * claim before being asked to connect anything.
 */
export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <section className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Scaffold-HBAR template</p>
        <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">Conditional Settlement Kit</h1>
        <p className="mt-5 text-lg text-base-content/80">
          Escrow a payout, attach it to a price condition, and let anyone settle it once the condition holds. The escrow
          is on-chain, the oracle is swappable, and every state change leaves a public record a counterparty can audit
          without being given access to anything.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/feeds" className="btn btn-primary">
            See the live feeds
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <Link href="/policies" className="btn btn-outline">
            Create a policy
          </Link>
        </div>
        <p className="mt-3 text-sm text-base-content/60">
          The first of those needs no wallet, no keys and no configuration.
        </p>
      </section>

      {/* The one design decision worth leading with. */}
      <section className="mt-16">
        <h2 className="text-2xl font-bold">The staleness bound belongs to the feed, not to the system</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-box border border-base-300 p-5">
            <p className="text-sm text-base-content/80">
              All seven Chainlink feeds on Hedera testnet declare the same 24-hour heartbeat, so every reading is
              &ldquo;within spec&rdquo;. Read live, their actual ages span more than a hundredfold — and which feed is
              the stale one changes from hour to hour.
            </p>
          </div>
          <div className="rounded-box border border-base-300 p-5">
            <p className="text-sm text-base-content/80">
              So one global <span className="font-mono text-xs">maxAge</span> fails both ways. Tight rejects healthy
              stablecoin feeds. Loose accepts an HBAR price a day old — roughly a hundred updates behind — and settles a
              payout on it without complaint. Nothing looks wrong when that happens, which is what makes it the
              dangerous direction.
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-base-content/70">
          <Link href="/feeds" className="link text-primary">
            Check that against the live feeds
          </Link>{" "}
          — the page reads them when you load it, so you are not taking this on trust.
        </p>
      </section>

      {/* The invariants are the product. They come from lib, not from prose. */}
      <section className="mt-16">
        <h2 className="text-2xl font-bold">What it guarantees</h2>
        <p className="mt-2 max-w-3xl text-base-content/70">
          Six invariants, each with the test that would catch it breaking. They are written before the code and they are
          not weakened to match an implementation that failed one.
        </p>

        <ul className="mt-6 space-y-3">
          {INVARIANTS.map(inv => (
            <li key={inv.id} className="rounded-box border border-base-300 p-5">
              <div className="flex items-start gap-3">
                <CheckBadgeIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="mr-2 font-mono text-xs text-base-content/50">{inv.id}</span>
                    {inv.statement}
                  </p>
                  <p className="mt-1.5 text-sm text-base-content/70">
                    <span className="font-medium">Proven by:</span> {inv.provenBy}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-base-content/50">packages/hardhat/test/{inv.testFile}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-bold">How it fits together</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Piece
            name="PolicyRegistry"
            role="Holds the escrow and the state machine. One guarded transition function; every state change goes through it."
          />
          <Piece
            name="Settlement"
            role="Reads the price, checks the condition, asks the registry to pay. Holds no value, so a bug here cannot drain anything directly."
          />
          <Piece
            name="IPriceSource"
            role="The seam. Settlement never names Chainlink, so the oracle is swappable without touching the contract that moves money."
          />
        </div>
        <p className="mt-4 text-sm text-base-content/70">
          Triggering is permissionless on purpose: the decision rests entirely on what the price source says, never on
          who is asking. A beneficiary should not have to depend on the creator&apos;s goodwill to get paid.
        </p>
      </section>
    </div>
  );
}

function Piece({ name, role }: { name: string; role: string }) {
  return (
    <div className="rounded-box border border-base-300 p-5">
      <h3 className="font-mono text-sm font-semibold text-primary">{name}</h3>
      <p className="mt-2 text-sm text-base-content/75">{role}</p>
    </div>
  );
}
