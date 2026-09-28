import Link from "next/link";
import { PolicyFlow } from "./_components/PolicyFlow";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Policies",
  description: "Create a policy, fund its escrow, and settle it when the price condition holds.",
};

/**
 * The route that needs a wallet.
 *
 * Everything above the flow is a Server Component, so the explanation
 * renders before any client JavaScript loads and a visitor who never
 * connects still learns what this does.
 */
export default function PoliciesPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Policies</h1>
        <p className="mt-2 max-w-3xl text-base-content/70">
          Create a promise, lock the payout, and settle it once the price hits the target.{" "}
          <Link href="/how-it-works" className="link text-primary">
            How it works
          </Link>
        </p>
      </header>

      <PolicyFlow />
    </div>
  );
}
