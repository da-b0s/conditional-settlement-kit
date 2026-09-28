import React, { Fragment } from "react";
import Link from "next/link";
import { toolLinks } from "~~/components/Header";

/**
 * Site footer. The theme toggle lives in the header and the faucet on the
 * Policies page, so nothing floats over the content here.
 */
export const Footer = () => {
  return (
    <footer className="min-h-0 py-6 px-1 border-t border-base-300 mt-8">
      <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-1 text-sm w-full text-base-content/60">
        <a href="https://github.com/da-b0s/talon" target="_blank" rel="noreferrer" className="link hover:text-primary">
          GitHub
        </a>
        <span className="opacity-30">|</span>
        <span>
          Built on{" "}
          <a
            href="https://hedera.com/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold link hover:text-primary"
          >
            Hedera
          </a>
        </span>
        <span className="opacity-30">|</span>
        <a href="https://docs.hedera.com/" target="_blank" rel="noreferrer" className="link hover:text-primary">
          Docs
        </a>
        {toolLinks.map(({ label, href }) => (
          <Fragment key={href}>
            <span className="opacity-30">|</span>
            <Link href={href} className="link hover:text-primary">
              {label}
            </Link>
          </Fragment>
        ))}
      </div>
    </footer>
  );
};
