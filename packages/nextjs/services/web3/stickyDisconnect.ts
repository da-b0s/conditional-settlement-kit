/**
 * Makes "Disconnect" mean disconnected — for every wallet, across reloads.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NEEDED FOR METAMASK AND NOT ONLY THE BURNER
 *
 * burnerOptIn.ts fixed a burner that connected itself to people who had never
 * clicked anything. It deliberately left MetaMask alone, on the reasoning that
 * reconnecting a previously-connected injected wallet is normal dApp
 * behaviour. That reasoning was wrong about the case that actually matters.
 *
 * Pressing Disconnect clears wagmi's state, but it does NOT revoke the site in
 * MetaMask's own permissions — nothing a dApp can do will. So on the next load
 * `reconnect()` asks `metaMask.isAuthorized()`, MetaMask answers true because
 * the site is still permitted, and the wallet the user just dismissed is back.
 * From the user's side the Disconnect button plainly does not work.
 *
 * The distinction that matters is not which connector it is. It is whether the
 * person asked to be disconnected. Silent reconnection is right after a plain
 * reload, and wrong after an explicit dismissal, and only the app can tell
 * those apart — so the app has to remember.
 * ---------------------------------------------------------------------------
 *
 * Deliberately NOT solved with `reconnectOnMount={false}` alone: that would
 * also stop the legitimate case, forcing a reconnect on every single visit.
 * The flag preserves convenience and honours the dismissal.
 */
const DISMISSED_KEY = "preflight.wallet.userDisconnected";

/** Storage throws outright in some privacy modes, and is absent during SSR. */
export function userDismissedWallet(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Call immediately BEFORE `disconnect()`, never after: wagmi's disconnect is
 * async and a reload racing it would otherwise find no flag and reconnect.
 */
export function markWalletDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "true");
  } catch {
    // A dismissal we cannot persist still holds for this page load.
  }
}

/** Called once a deliberate connection succeeds, so reloads resume reconnecting. */
export function clearWalletDismissed(): void {
  try {
    window.localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Nothing to undo.
  }
}
