import { rainbowkitBurnerWallet } from "burner-connector";
import { createConnector } from "wagmi";
import type { CreateConnectorFn } from "wagmi";

/**
 * Makes the burner wallet opt-in.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FIXES
 *
 * Out of the box, the burner wallet connects itself on every page load — to a
 * first-time visitor who has never clicked anything, and again immediately
 * after the user explicitly presses Disconnect. Three upstream behaviours
 * combine to cause it:
 *
 *   1. `WagmiProvider` defaults `reconnectOnMount` to true.
 *   2. wagmi's `reconnect()` does not only retry the last-used connector. With
 *      no `connectors` argument it iterates EVERY registered connector
 *      (`connectors.push(...config.connectors)`), keeping the first that
 *      reports itself authorized. Sorting prefers the recent one; it does not
 *      exclude the others.
 *   3. burner-connector's `isAuthorized()` is effectively a constant `true`:
 *
 *        let connected = true;                       // fresh on every load
 *        async isAuthorized() {
 *          if (!connected) return false;
 *          return !!(await this.getAccounts()).length;
 *        }
 *
 *      `connected` is module-state, so a reload resets it to true, and
 *      `getAccounts()` cannot come back empty because `loadBurnerPK()`
 *      GENERATES AND PERSISTS a key when it does not find one.
 *
 * So the burner is always authorized, for everybody, forever. Disconnect works
 * correctly — wagmi clears its state — and then the next load hands the slot
 * straight back to the burner. To a user who disconnected MetaMask, that is
 * indistinguishable from "it reconnected my wallet by itself".
 *
 * Step 3 also means a private key is written into the browser of every visitor
 * who merely loads the page. That is unacceptable for a tool about doing
 * Hedera correctly, regardless of the balance being zero.
 *
 * ---------------------------------------------------------------------------
 * THE FIX, AND WHY NOT THE OBVIOUS ONE
 *
 * `reconnectOnMount={false}` would stop it, but it also breaks MetaMask: a
 * returning user would have to reconnect on every page load. Legitimate
 * reconnection is worth keeping. Removing the burner is also not open to us —
 * harness Tier 3.5 signs headlessly with it.
 *
 * So the burner stays in the wallet list and stays fully functional; it simply
 * stops claiming authorization it was never given. It is authorized only after
 * someone deliberately picks it, and Disconnect revokes that.
 *
 * `getProvider` additionally undoes any key the reconnect probe forced it to
 * mint, so a visitor who never asked for a wallet is not given one. See the
 * comment on that method for why it cleans up rather than refusing.
 *
 * The private key itself survives disconnect on purpose — a developer who
 * funded their burner expects the same account back when they reconnect.
 * ---------------------------------------------------------------------------
 */
const BURNER_OPT_IN_KEY = "preflight.burnerWallet.optIn";

/** Storage can throw outright in private mode, and is absent during SSR. */
const readOptIn = (): boolean => {
  try {
    return window.localStorage.getItem(BURNER_OPT_IN_KEY) === "true";
  } catch {
    return false;
  }
};

const writeOptIn = (value: boolean): void => {
  try {
    if (value) window.localStorage.setItem(BURNER_OPT_IN_KEY, "true");
    else window.localStorage.removeItem(BURNER_OPT_IN_KEY);
  } catch {
    // A burner that cannot remember the opt-in still works for this page load.
  }
};

/** Where burner-connector keeps the key, and under which name. */
const BURNER_PK_KEY = "burnerWallet.pk";

const burnerStorage = (): Storage | null => {
  try {
    return rainbowkitBurnerWallet.useSessionStorage ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

const hasStoredKey = (): boolean => !!burnerStorage()?.getItem(BURNER_PK_KEY);

const clearStoredKey = (): void => {
  try {
    burnerStorage()?.removeItem(BURNER_PK_KEY);
  } catch {
    // Nothing to undo; a key we could not remove is inert while opted out.
  }
};

/**
 * The stock burner wallet, wrapped so it only ever connects on purpose.
 * Same id, name and icon, so it appears in the RainbowKit modal unchanged.
 */
export const optInBurnerWallet: typeof rainbowkitBurnerWallet = () => {
  const wallet = rainbowkitBurnerWallet();

  return {
    ...wallet,
    createConnector: (walletDetails: Parameters<typeof wallet.createConnector>[0]) => {
      const baseFn = wallet.createConnector(walletDetails) as CreateConnectorFn;

      return createConnector(config => {
        const base = baseFn(config);

        // Asserted back to the base connector's own shape. burner-connector
        // types `connect` with a plain `withCapabilities?: boolean` while wagmi
        // types it as a generic whose return type is conditional on that flag,
        // so no hand-written signature can satisfy both. Every method below is
        // a pure passthrough that changes only whether the call is permitted,
        // never what it returns, so the runtime shape is exactly `base`.
        return {
          ...base,

          // This cannot simply refuse while opted out: RainbowKit calls
          // getProvider BEFORE connect, to render its "opening wallet" step,
          // so throwing here leaves the modal spinning forever and the burner
          // unusable. (`reconnect()` would have tolerated a throw. RainbowKit
          // does not.)
          //
          // So it answers, and then cleans up after itself. The upstream
          // loader mints and persists a key whenever it fails to find one, and
          // a probe must not leave a wallet behind in the browser of someone
          // who only loaded the page. A key that was already there is left
          // alone — it belongs to a developer who connected before, or who
          // pasted one into the Set Private Key modal.
          async getProvider(params?: { chainId?: number }) {
            if (readOptIn()) return base.getProvider(params);

            const keyExisted = hasStoredKey();
            const provider = await base.getProvider(params);
            if (!keyExisted) clearStoredKey();
            return provider;
          },

          async isAuthorized() {
            if (!readOptIn()) return false;
            return base.isAuthorized();
          },

          // wagmi passes `isReconnecting: true` when this is an automatic
          // retry, so the flag can only ever be set by a deliberate connect.
          async connect(params?: Parameters<typeof base.connect>[0]) {
            const chosenByUser = !params?.isReconnecting;
            if (chosenByUser) writeOptIn(true);
            try {
              return await base.connect(params);
            } catch (error) {
              // Do not leave an opt-in behind for a connect that never landed,
              // or the next reload would connect a wallet the user never got.
              if (chosenByUser) writeOptIn(false);
              throw error;
            }
          },

          async disconnect() {
            writeOptIn(false);
            return base.disconnect();
          },
        } as typeof base;
      });
    },
  };
};
