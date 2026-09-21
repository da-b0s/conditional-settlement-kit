"use client";

import { useEffect, useRef } from "react";
import { useAccount, useConfig } from "wagmi";
import { reconnect } from "wagmi/actions";
import { clearWalletDismissed, userDismissedWallet } from "~~/services/web3/stickyDisconnect";

/**
 * Reconnects the last wallet on load — unless the user disconnected on purpose.
 *
 * `WagmiProvider` has `reconnectOnMount={false}` so that nothing reconnects
 * behind this check; the reconnection wagmi would have done automatically is
 * done here instead, one tick later, with the dismissal consulted first.
 *
 * Renders nothing. See services/web3/stickyDisconnect.ts for why a flag is
 * needed at all — the short version is that Disconnect cannot revoke the site
 * inside MetaMask, so without this the button appears not to work.
 */
export const WalletReconnectGate = () => {
  const config = useConfig();
  const { status } = useAccount();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (userDismissedWallet()) return;
    // Failure here is not an error worth surfacing: no previously authorized
    // wallet is the ordinary first-visit case.
    void reconnect(config).catch(() => undefined);
  }, [config]);

  // Once a connection is live, the dismissal has been overridden by a
  // deliberate connect, so later reloads should reconnect normally again.
  useEffect(() => {
    if (status === "connected") clearWalletDismissed();
  }, [status]);

  return null;
};
