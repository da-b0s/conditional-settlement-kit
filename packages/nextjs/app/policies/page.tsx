import Link from "next/link";
import { PolicyFlow } from "./_components/PolicyFlow";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Policies · Conditional Settlement Kit",
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
          A policy is an escrowed promise:{" "}
          <em>if this feed reaches this price before this deadline, pay this beneficiary</em>. The escrow is funded up
          front and the contract refuses to activate a policy that promises more than it holds — so a beneficiary who
          sees <span className="font-mono text-xs">Active</span> knows the money is actually there.
        </p>
        <p className="mt-3 max-w-3xl text-sm text-base-content/70">
          Settling is permissionless. Anyone can push a settlement once the condition holds, because the decision rests
          on what the price source says and not on who is asking.{" "}
          <Link href="/feeds" className="link text-primary">
            Check what the feeds are doing
          </Link>{" "}
          before you pick a threshold.
        </p>
      </header>

      <PolicyFlow />
    </div>
  );
}
