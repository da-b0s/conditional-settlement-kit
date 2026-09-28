"use client";

import React, { useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import {
  Bars3Icon,
  ClipboardDocumentCheckIcon,
  QuestionMarkCircleIcon,
  ScaleIcon,
  SignalIcon,
} from "@heroicons/react/24/outline";
import { SwitchTheme } from "~~/components/SwitchTheme";
import { TalonMark } from "~~/components/TalonMark";
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
    label: "How it works",
    href: "/how-it-works",
    icon: <QuestionMarkCircleIcon className="h-4 w-4" />,
  },
  {
    // The credential-free routes come before anything that asks for a wallet.
    label: "Live prices",
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
];

/** Developer tools: linked from the footer, not the main menu. */
export const toolLinks: HeaderMenuLink[] = [
  { label: "Debug Contracts", href: "/debug" },
  { label: "Block Explorer", href: "/blockexplorer" },
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
          <summary className="ml-1 btn btn-ghost lg:hidden hover:bg-transparent" aria-label="Menu">
            <Bars3Icon className="h-6 w-6" />
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
        <Link
          href="/"
          passHref
          className="flex items-center gap-2.5 ml-1 lg:ml-4 mr-6 shrink-0"
          aria-label="Talon home"
        >
          <TalonMark className="h-8 w-8 shrink-0" />
          <span className="text-lg font-semibold tracking-[0.2em]">TALON</span>
        </Link>
        <ul className="hidden lg:flex flex-nowrap menu menu-horizontal px-1 gap-1">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end w-auto shrink-0 ml-auto mr-2 sm:mr-4 gap-2">
        <SwitchTheme />
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
