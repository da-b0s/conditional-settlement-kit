import Link from "next/link";
import type { Metadata } from "next";
import { CheckBadgeIcon } from "@heroicons/react/24/outline";
import { TESTNET_FEEDS } from "~~/lib/settlement/feeds";
import { INVARIANTS } from "~~/lib/settlement/invariants";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How a Talon policy locks HBAR, watches a price, and pays out or refunds. Plus answers to common questions.",
};

const STEPS = [
  {
    title: "Write the promise",
    text: "Choose who gets paid, how much, which price to watch, the target, and a deadline.",
  },
  {
    title: "Lock the money",
    text: "Deposit the payout. The policy only goes live once the full amount is held, so the person being paid knows it is really there.",
  },
  {
    title: "Watch the price",
    text: "Talon reads the price from Chainlink and refuses any reading that is too old for that coin.",
  },
  {
    title: "Pay out",
    text: "Once the price hits the target, anyone can press Settle. The payout goes to the person named, once, and the policy closes.",
  },
  {
    title: "Or refund",
    text: "If the deadline passes first, anyone can mark it expired and the creator takes the money back. It can never be both paid and refunded.",
  },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is a policy?",
    a: "A promise with money locked behind it: if this price reaches this target before this deadline, pay this person. The rules live in a contract on Hedera, so nobody, including the creator, can change them afterwards.",
  },
  {
    q: "Why can anyone press Settle?",
    a: (
      <>
        So nobody is a gatekeeper. If only the creator could settle, they could simply never do it. If only the person
        being paid could, they would need to be online with a wallet at the right moment. The contract ignores who
        presses the button and checks only the price, and the money can only ever go to the person named. In practice
        the one settling is the person being paid, someone helping them, or an app that settles automatically.
      </>
    ),
  },
  {
    q: "What if the price hits the target, then drops back?",
    a: "The price is checked at the moment someone presses Settle, not whether it touched the target at some point. If nobody settles while the price is there, the chance can pass. That is why letting anyone settle, including an automated service, matters.",
  },
  {
    q: "Where do prices come from, and why are some refused?",
    a: (
      <>
        From Chainlink price feeds on Hedera. Every feed claims to update at least daily, but in practice some update
        every few minutes and others every few hours. So each coin gets its own freshness limit: an HBAR price more than
        an hour old is refused, while stablecoins may be up to a day old. One limit for everything would either refuse
        healthy prices or pay out on stale ones.{" "}
        <Link href="/feeds" className="link text-primary">
          See the live prices and their ages
        </Link>
        .
      </>
    ),
  },
  {
    q: "Which prices can I use?",
    a: `${TESTNET_FEEDS.map(f => f.pair).join(", ")}. All are quoted in US dollars.`,
  },
  {
    q: "Can I cancel early and get my money back?",
    a: "No. Once a policy is live the money stays locked until it pays out or the deadline passes. That is what makes the promise worth something to the person being paid.",
  },
  {
    q: "What if I deposit more than the payout?",
    a: "The person being paid receives exactly the payout. The rest is set aside for you, and you claim it with Withdraw on the Policies page.",
  },
  {
    q: "What is the evidence record?",
    a: (
      <>
        A public log on Hedera&apos;s consensus service that anyone can read without an account. It records that a
        policy was created, triggered and settled, using only numbers and hashes, never names or addresses. It is
        written separately by an operator, so it can lag behind the contracts.{" "}
        <Link href="/evidence" className="link text-primary">
          Read the record
        </Link>
        .
      </>
    ),
  },
  {
    q: "Is this real money?",
    a: "No. Talon runs on Hedera testnet, where HBAR is free from the faucet and has no value. The contracts are unaudited, so treat this as a working demonstration, not a financial product.",
  },
  {
    q: "What does it cost?",
    a: "Only network fees, paid in test HBAR: a small amount to create, fund, settle, expire, refund or withdraw. Reading prices and the evidence record is free.",
  },
];

const PIECES = [
  {
    name: "PolicyRegistry",
    role: "Holds the money and the rules for moving between states. Every change goes through one guarded function.",
  },
  {
    name: "Settlement",
    role: "Reads the price, checks the target and asks the registry to pay. It holds no money itself.",
  },
  {
    name: "IPriceSource",
    role: "The plug for price data. Chainlink today; another provider can be swapped in without touching the money.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold sm:text-4xl">How it works</h1>
      <p className="mt-3 text-lg text-base-content/75">
        A policy is a promise with money locked behind it, released only when a price condition is true.
      </p>

      <ol className="mt-8 space-y-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-4 rounded-box border border-base-300 p-4">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-content">
              {index + 1}
            </span>
            <div>
              <h2 className="font-semibold">{step.title}</h2>
              <p className="mt-0.5 text-sm text-base-content/70">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-14">
        <h2 className="text-2xl font-bold">Two sides of one policy</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-box border border-base-300 p-5">
            <h3 className="font-semibold">If you are paying</h3>
            <p className="mt-2 text-sm text-base-content/70">
              You make a promise people can trust without a middleman. In exchange, you cannot take the money back
              early: it pays out if the target is hit, or returns to you after the deadline.
            </p>
          </div>
          <div className="rounded-box border border-base-300 p-5">
            <h3 className="font-semibold">If you are being paid</h3>
            <p className="mt-2 text-sm text-base-content/70">
              You can see the money is locked before relying on it, and you never have to ask the creator for anything.
              When the target is hit, you or anyone else can settle it.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-2xl font-bold">Questions</h2>
        <div className="mt-4 space-y-2">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="collapse collapse-arrow rounded-box border border-base-300 bg-base-100">
              <summary className="collapse-title font-medium">{q}</summary>
              <div className="collapse-content text-sm text-base-content/75">
                <p>{a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-2xl font-bold">For developers</h2>
        <p className="mt-2 text-base-content/70">
          Six guarantees, each checked by its own test. The source is on{" "}
          <a href="https://github.com/da-b0s/talon" target="_blank" rel="noreferrer" className="link text-primary">
            GitHub
          </a>
          .
        </p>
        <ul className="mt-4 space-y-2">
          {INVARIANTS.map(inv => (
            <li key={inv.id} className="flex items-start gap-3 rounded-box border border-base-300 p-4">
              <CheckBadgeIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  <span className="mr-2 font-mono text-xs text-base-content/50">{inv.id}</span>
                  {inv.statement}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-base-content/50">{inv.testFile}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {PIECES.map(piece => (
            <div key={piece.name} className="rounded-box border border-base-300 p-4">
              <h3 className="font-mono text-sm font-semibold text-primary">{piece.name}</h3>
              <p className="mt-2 text-sm text-base-content/70">{piece.role}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
