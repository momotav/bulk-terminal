'use client';

import { useEffect, useState } from 'react';
import { request } from '@/lib/api';
import { HIDDEN_COINS, coinClass, type AssetClass } from '@/lib/coins';
import { useCurrentNetwork } from './useCurrentNetwork';
import { useAssetClass } from './useAssetClass';
import type { NetworkId } from '@/lib/network';

/**
 * Minimal market metadata shape returned by the backend's `/exchange-info`
 * proxy (which normalizes BULK's /exchangeInfo). Extend as needed.
 */
export interface MarketInfo {
  /** Full symbol (e.g. "BTC-USD"). */
  symbol: string;
  /** Base asset without the -USD suffix (e.g. "BTC"). Used as the coin key. */
  coin: string;
  /**
   * 'crypto' | 'stock', stamped by the backend from its curated list. Optional
   * because older backends don't send it — we fall back to the frontend's own
   * STOCK_COINS table via `coinClass()`.
   */
  assetClass?: Exclude<AssetClass, 'all'>;
  quoteAsset: string;
  status: string;
  maxLeverage: number;
  tickSize: number;
  lotSize: number;
  minNotional: number;
}

interface ExchangeInfoResponse {
  markets: MarketInfo[];
  count: number;
  timestamp: number;
}

export interface UseAvailableCoinsResult {
  /** Coin keys visible under the current asset-class filter ("BTC", "ETH", …). */
  coins: string[];
  /** Market metadata for the visible coins, in BULK's listing order. */
  markets: MarketInfo[];
  /** Every (non-hidden) market regardless of the class filter. */
  allMarkets: MarketInfo[];
  /** Market counts per class — for "23 crypto · 8 stocks" captions. */
  counts: Record<AssetClass, number>;
  /** The active class filter, re-exported for convenience. */
  assetClass: AssetClass;
  /** Default pills for the active class (BTC/ETH/SOL or SNDK/MU/NVDA). */
  defaults: readonly string[];
  /** True while the first fetch is in flight. */
  loading: boolean;
  /** Non-null if the fetch failed; the hook falls back to DEFAULT_COINS in that case. */
  error: string | null;
}

// Per-network, module-level cache so components sharing this hook on one page
// trigger a single request per network — and switching networks fetches the
// other network's market list (devnet lists markets testnet doesn't).
const cachedMarkets = new Map<NetworkId, MarketInfo[]>();
const inflight = new Map<NetworkId, Promise<MarketInfo[]>>();

async function fetchMarkets(net: NetworkId): Promise<MarketInfo[]> {
  const hit = cachedMarkets.get(net);
  if (hit) return hit;
  const pending = inflight.get(net);
  if (pending) return pending;

  const p = (async () => {
    try {
      // request() appends ?net=<current> so the backend routes /exchangeInfo
      // to the matching BULK host.
      const data = await request<ExchangeInfoResponse>('/api/analytics/exchange-info');
      const markets = Array.isArray(data?.markets) ? data.markets : [];
      cachedMarkets.set(net, markets);
      return markets;
    } finally {
      inflight.delete(net);
    }
  })();

  inflight.set(net, p);
  return p;
}

/**
 * Fetch the list of coins supported by BULK. Automatically reflects any new
 * markets BULK adds, because the list comes from /exchangeInfo at runtime
 * rather than being hardcoded in the codebase.
 *
 * If the request fails, we fall back to the DEFAULT_COINS constant so the
 * site still works — a chart with BTC/ETH/SOL is better than a blank chart.
 */
export function useAvailableCoins(): UseAvailableCoinsResult {
  const { network } = useCurrentNetwork();
  const [markets, setMarkets] = useState<MarketInfo[]>(() => cachedMarkets.get(network) ?? []);
  const [loading, setLoading] = useState<boolean>(() => !cachedMarkets.has(network));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hit = cachedMarkets.get(network);
    if (hit) {
      // Already cached for this network — populate state and skip the fetch.
      setMarkets(hit);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchMarkets(network)
      .then((m) => {
        if (cancelled) return;
        setMarkets(m);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to fetch exchange info:', err);
        setError(err instanceof Error ? err.message : 'Failed to load markets');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [network]);

  // Filter out any coins listed in HIDDEN_COINS (e.g. XAU) so they never
  // appear in pickers, dropdowns, chart toggles, or the treemap. One
  // centralized filter means no consumer has to remember to exclude them.
  const hiddenSet = new Set(HIDDEN_COINS);
  const allMarkets = markets.filter(m => !hiddenSet.has(m.coin));

  // Then the site-wide All / Crypto / Stocks filter. Trust the backend's
  // stamp when it sent one; otherwise classify locally. Doing it HERE means
  // every picker, chart toggle, treemap and map narrows automatically.
  const { assetClass, defaults } = useAssetClass();
  const classOf = (m: MarketInfo) =>
    m.assetClass === 'stock' || m.assetClass === 'crypto' ? m.assetClass : coinClass(m.coin);
  const counts: Record<AssetClass, number> = { all: allMarkets.length, crypto: 0, stock: 0 };
  for (const m of allMarkets) counts[classOf(m)] += 1;
  const visibleMarkets = assetClass === 'all'
    ? allMarkets
    : allMarkets.filter((m) => classOf(m) === assetClass);

  // Extract just the coin keys, preserving BULK's ordering. If the fetch
  // failed and we have nothing, fall back to the class's defaults.
  const coins = visibleMarkets.length > 0
    ? visibleMarkets.map((m) => m.coin)
    : ([...defaults] as string[]);

  return { coins, markets: visibleMarkets, allMarkets, counts, assetClass, defaults, loading, error };
}
