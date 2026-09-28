import { DebugContracts } from "./_components/DebugContracts";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Debug Contracts",
  description: "Read and call the deployed Talon contracts directly.",
});

const Debug: NextPage = () => {
  return (
    <>
      <DebugContracts />
      {/* Stock scaffold orientation block, restyled rather than removed.
          It shipped as text-neutral (#121418) on bg-secondary (#262a31): a
          contrast ratio of 1.28:1 against the 4.5:1 WCAG AA needs, so the
          sentence was invisible rather than merely dim. Both tokens are dark
          under this theme, which the stock palette did not anticipate.
          base-content on base-200 measures 17.05:1 in light and 16.76:1 in
          dark. Kept because removing scaffold conventions is a non-goal. */}
      <div className="mt-10 border-t border-base-300 bg-base-200">
        <div className="max-w-6xl mx-auto px-5 py-10 text-center">
          <h2 className="text-xl font-bold text-base-content mb-1">Debug Contracts</h2>
          <p className="text-sm text-base-content/70 m-0">
            Interact with every deployed contract directly. Read functions need no wallet — try{" "}
            <code className="px-1 rounded bg-base-300 text-base-content">isLongZero</code> with{" "}
            <code className="px-1 rounded bg-base-300 text-base-content">0x00…02</code>.
          </p>
          <p className="text-xs text-base-content/60 mt-2 m-0">
            Edit at{" "}
            <code className="px-1 rounded bg-base-300 text-base-content">packages/nextjs/app/debug/page.tsx</code>
          </p>
        </div>
      </div>
    </>
  );
};

export default Debug;
