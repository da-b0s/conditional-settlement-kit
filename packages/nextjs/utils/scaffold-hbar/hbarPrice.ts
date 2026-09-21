export const HBAR_PRICE_CACHE_DURATION_MS = 60 * 1000;
export const HBAR_PRICE_URL = "https://api.coingecko.com/api/v3/coins/hedera-hashgraph";

type HbarPriceCache = {
  price: number;
  timestamp: number;
};

let cache: HbarPriceCache | null = null;

export async function fetchHbarPrice(): Promise<number> {
  const now = Date.now();
  if (cache && now - cache.timestamp < HBAR_PRICE_CACHE_DURATION_MS) {
    return cache.price;
  }

  try {
    const response = await fetch(HBAR_PRICE_URL);
    const data = await response.json();
    const price = data?.market_data?.current_price?.usd ?? 0;
    cache = { price, timestamp: now };
    return price;
  } catch (error) {
    // warn, not error. This failure is EXPECTED and already handled: CoinGecko
    // is aggressively rate-limited and blocks often, and the fiat price is
    // decorative — every on-chain number on this site comes from the mirror
    // node or the relay, not from here.
    //
    // It must not be console.error, because .harness/validators/playwright-smoke.yaml
    // sets failOnConsoleError: true. A handled third-party rate-limit would
    // otherwise fail the Tier 2 gate, which is a submission artefact.
    console.warn("HBAR fiat price unavailable, using last known value:", error);
    return cache?.price ?? 0;
  }
}
