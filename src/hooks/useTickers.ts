'use client';

// Live per-market ticker feed.
//
// Wraps /api/analytics/tickers-bulk, which returns one entry per active
// BULK market in a single call. Two dashboard surfaces consume this (the
// ticker strip and the markets table), so the hook is called once at the
// page level and the result passed down — hitting the endpoint twice for
// the same paint would be wasteful and could show the two panels
// disagreeing about price for a frame.

import { useEffect, useState } from 'react';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';

// Matches the backend's ticker shape. Only the fields the dashboard
// actually renders are typed; the endpoint also returns regime/fair-value
// diagnostics that belong to the analytics pages, not here.
export interface BulkTicker {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  markPrice: number;
  oraclePrice: number;
  openInterest: number;
  fundingRate: number;
}

// Prices move constantly, so this polls faster than the 30s trading
// aggregates but slower than the 3s chain telemetry. 10s keeps the strip
// feeling live without hammering the upstream exchange API.
const POLL_INTERVAL_MS = 10_000;

export function useTickers() {
  const { network } = useCurrentNetwork();
  const [tickers, setTickers] = useState<BulkTicker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchTickers = async () => {
      try {
        const res = await fetch(`${API_URL}${withNetwork('/api/analytics/tickers-bulk')}`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;

        const rows: BulkTicker[] = (json.tickers || [])
          .map((t: any) => ({
            symbol: String(t.symbol ?? ''),
            lastPrice: Number(t.lastPrice) || 0,
            priceChange: Number(t.priceChange) || 0,
            priceChangePercent: Number(t.priceChangePercent) || 0,
            highPrice: Number(t.highPrice) || 0,
            lowPrice: Number(t.lowPrice) || 0,
            volume: Number(t.volume) || 0,
            quoteVolume: Number(t.quoteVolume) || 0,
            markPrice: Number(t.markPrice) || 0,
            oraclePrice: Number(t.oraclePrice) || 0,
            openInterest: Number(t.openInterest) || 0,
            fundingRate: Number(t.fundingRate) || 0,
          }))
          // Busiest market first — the ordering the table and strip both want.
          .sort((a: BulkTicker, b: BulkTicker) => b.quoteVolume - a.quoteVolume);

        setTickers(rows);
        setLoading(false);
      } catch {
        // Silent. Markets are an enhancement to the dashboard, not a
        // blocker — on failure we keep showing the last known prices.
      }
    };

    fetchTickers();
    const tick = window.setInterval(fetchTickers, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [network]);

  return { tickers, loading };
}

// Open interest arrives denominated in the base coin. Multiplying by mark
// price gives the USD notional every other figure on the dashboard uses.
export function openInterestUsd(t: BulkTicker): number {
  return t.openInterest * (t.markPrice || t.lastPrice);
}

// Price formatting has to span BTC at ~66,000 and FARTCOIN at fractions of
// a cent, so precision scales with magnitude rather than being fixed.
export function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '--';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}
