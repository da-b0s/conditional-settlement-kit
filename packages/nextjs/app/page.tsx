import Link from "next/link";
import { ArrowRightIcon, ArrowUturnLeftIcon, EyeIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { TalonMark } from "~~/components/TalonMark";

/**
 * The landing page: one sentence, two actions, three steps.
 *
 * Everything that explains more lives on /how-it-works. A Server Component
 * with no wallet prompt, so a visitor understands what this is before being
 * asked to connect anything.
 */
const STEPS = [
  {
    icon: LockClosedIcon,
    title: "Lock",
    text: "Set a price target and a deadline, then deposit the payout.",
  },
  {
    icon: EyeIcon,
    title: "Watch",
    text: "Talon checks a fresh Chainlink price. Old prices are refused.",
  },
  {
    icon: ArrowUturnLeftIcon,
    title: "Release",
    text: "Target hit: the payout is sent. Deadline passed: you get it back.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:py-20">
      <section className="flex flex-col-reverse items-start gap-10 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">Holds until it&apos;s true.</h1>
          <p className="mt-5 text-lg text-base-content/75">
            Lock HBAR into a promise that pays out automatically when a price hits your target, or comes back to you if
            it doesn&apos;t.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/policies" className="btn btn-primary">
              Create a policy
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
            <Link href="/how-it-works" className="btn btn-outline">
              How it works
            </Link>
          </div>
          <p className="mt-4 text-sm text-base-content/60">
            Runs on Hedera testnet with free test HBAR.{" "}
            <Link href="/feeds" className="link text-primary">
              See live prices
            </Link>
          </p>
        </div>
        <TalonMark className="hidden h-40 w-40 shrink-0 text-base-content md:block" />
      </section>

      <section className="mt-16 grid gap-4 sm:mt-24 sm:grid-cols-3" aria-label="How it works in three steps">
        {STEPS.map(({ icon: Icon, title, text }, index) => (
          <div key={title} className="rounded-box border border-base-300 bg-base-100 p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-base-content/50">
                Step {index + 1}
              </span>
            </div>
            <h2 className="mt-4 text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-base-content/70">{text}</p>
          </div>
        ))}
      </section>

      <p className="mt-8 text-center text-sm text-base-content/60">
        Anyone can trigger the payout once the target is hit, so nobody has to wait on the other side.{" "}
        <Link href="/how-it-works" className="link text-primary">
          Read how it works
        </Link>
      </p>
    </div>
  );
}
