'use client';

import { useEffect, useState } from 'react';
import { request } from '@/lib/api';
import { DEFAULT_COINS } from '@/lib/coins';

/**
 * Minimal market metadata shape returned by the backend's `/exchange-info`
 * proxy (which normalizes BULK's /exchangeInfo). Extend as needed.
 */
export interface MarketInfo {
  /** Full symbol (e.g. "BTC-USD"). */
  symbol: string;
  /** Base asset without the -USD suffix (e.g. "BTC"). Used as the coin key. */
  coin: string;
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
  /** Array of all coin keys (just the bases: "BTC", "ETH", ...). */
  coins: string[];
  /** Full market metadata list, indexed by order returned from BULK. */
  markets: MarketInfo[];
  /** True while the first fetch is in flight. */
  loading: boolean;
  /** Non-null if the fetch failed; the hook falls back to DEFAULT_COINS in that case. */
  error: string | null;
}

// Module-level cache so multiple components sharing this hook in one page
// render only trigger a single network request per session.
let cachedMarkets: MarketInfo[] | null = null;
let inflight: Promise<MarketInfo[]> | null = null;

async function fetchMarkets(): Promise<MarketInfo[]> {
  if (cachedMarkets) return cachedMarkets;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const data = await request<ExchangeInfoResponse>('/api/analytics/exchange-info');
      const markets = Array.isArray(data?.markets) ? data.markets : [];
      cachedMarkets = markets;
      return markets;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
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
  const [markets, setMarkets] = useState<MarketInfo[]>(() => cachedMarkets ?? []);
  const [loading, setLoading] = useState<boolean>(() => cachedMarkets === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cachedMarkets) {
      // Already cached — no work needed, state is already populated.
      setLoading(false);
      return;
    }
    fetchMarkets()
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
  }, []);

  // Extract just the coin keys, preserving BULK's ordering. If the fetch
  // failed and we have nothing, fall back to the defaults.
  const coins = markets.length > 0
    ? markets.map((m) => m.coin)
    : ([...DEFAULT_COINS] as string[]);

  return { coins, markets, loading, error };
}
