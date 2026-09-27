"use client";

import React, { useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import {
  Bars3Icon,
  BugAntIcon,
  ClipboardDocumentCheckIcon,
  MagnifyingGlassIcon,
  ScaleIcon,
  SignalIcon,
} from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useOutsideClick } from "~~/hooks/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar/useTargetNetwork";
import { getExplorerLink } from "~~/utils/scaffold-hbar/networks";

type HeaderMenuLink = {
  label: string;
  href: string;
  icon?: React.ReactNode;
};

export const menuLinks: HeaderMenuLink[] = [
  {
    label: "Home",
    href: "/",
  },
  {
    // The two credential-free routes come first, before anything that asks
    // for a wallet. Feeds is the evidence for the central design claim and a
    // visitor should be able to check it before being asked for anything.
    label: "Feeds",
    href: "/feeds",
    icon: <SignalIcon className="h-4 w-4" />,
  },
  {
    label: "Evidence",
    href: "/evidence",
    icon: <ClipboardDocumentCheckIcon className="h-4 w-4" />,
  },
  {
    label: "Policies",
    href: "/policies",
    icon: <ScaleIcon className="h-4 w-4" />,
  },
  {
    label: "Debug Contracts",
    href: "/debug",
    icon: <BugAntIcon className="h-4 w-4" />,
  },
  {
    label: "Block Explorer",
    href: "/blockexplorer",
    icon: <MagnifyingGlassIcon className="h-4 w-4" />,
  },
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  return (
    <>
      {menuLinks.map(({ label, href, icon }) => {
        const isActive = pathname === href;
        const destination = href === "/blockexplorer" ? getExplorerLink(targetNetwork, address) : href;
        if (destination.startsWith("https://"))
          return (
            <li key={href}>
              <a
                href={destination}
                target="_blank"
                rel="noreferrer"
                className="py-1.5 px-3 text-sm rounded-full gap-2 flex hover:bg-primary/5"
              >
                {icon}
                <span>{label}</span>
              </a>
            </li>
          );
        return (
          <li key={href}>
            <Link
              href={href}
              passHref
              className={`${
                isActive ? "bg-primary/10 text-primary font-semibold" : "hover:bg-primary/5"
              } py-1.5 px-3 text-sm rounded-full gap-2 grid grid-flow-col transition-colors`}
            >
              {icon}
              <span>{label}</span>
              <NavigationStatus />
            </Link>
          </li>
        );
      })}
    </>
  );
};

function NavigationStatus() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span role="status">
      <span className="loading loading-spinner loading-xs" aria-hidden="true" />
      <span className="sr-only">Loading page</span>
    </span>
  ) : null;
}

/**
 * Site header
 */
export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100 min-h-0 shrink-0 justify-between z-20 shadow-sm border-b border-base-300 px-0 sm:px-2">
      <div className="navbar-start w-auto min-w-0">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary className="ml-1 btn btn-ghost 2xl:hidden hover:bg-transparent">
            <Bars3Icon className="h-1/2" />
          </summary>
          <ul
            className="menu menu-compact dropdown-content mt-3 p-2 shadow-sm bg-base-100 rounded-box w-52"
            onClick={() => {
              burgerMenuRef?.current?.removeAttribute("open");
            }}
          >
            <HeaderMenuLinks />
          </ul>
        </details>
        <Link href="/" passHref className="hidden lg:flex items-center gap-3 ml-4 mr-6 shrink-0">
          {/* Inline rather than next/image: an <img> does not inherit the
              surrounding text colour, so a single currentColor mark needs to
              be real SVG in the document to work in both themes. */}
          <svg viewBox="0 0 32 32" className="w-9 h-9 shrink-0 text-primary" aria-hidden="true" fill="none">
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" opacity="0.35" />
            <path d="M16 6v20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M8 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="8" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
            <circle cx="24" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
          </svg>
          <div className="flex flex-col">
            <span className="font-bold leading-tight text-base">Settlement Kit</span>
            <span className="text-[10px] tracking-wider uppercase text-base-content/50 font-medium">
              Conditional settlement on Hedera
            </span>
          </div>
        </Link>
        <ul className="hidden 2xl:flex flex-nowrap menu menu-horizontal px-1 gap-2">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end w-auto shrink-0 ml-auto mr-4 gap-2">
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
