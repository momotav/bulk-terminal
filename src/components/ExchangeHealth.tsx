'use client';

import { useEffect, useState } from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import { StatCard } from './StatCard';
import { Sparkline } from './Sparkline';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

interface ExchangeStats {
  volume24h: number;
  openInterest: number;
  activeTraders: number;
  liquidations24h: number;
  timestamp: number;
}

type SparkKey = 'volume24h' | 'openInterest' | 'activeTraders' | 'liquidations24h';
type Sparklines = Record<SparkKey, { series: number[]; changePct: number | null }>;

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';

// Formatters live at module scope so their identity is stable across
// renders — AnimatedNumber keys a subscription off the `format` prop,
// and an inline arrow would tear it down and rebuild it every tick.
const formatNumber = (num: number | undefined | null): string => {
  if (num === undefined || num === null || isNaN(num)) return '$0.00';

  if (num >= 1_000_000_000) {
    return `$${(num / 1_000_000_000).toFixed(2)}B`;
  } else if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(2)}M`;
  } else if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(2)}K`;
  }
  return `$${num.toFixed(2)}`;
};

const formatCount = (num: number | undefined | null): string => {
  if (num === undefined || num === null || isNaN(num)) return '0';

  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(2)}K`;
  }
  return num.toLocaleString();
};

export function ExchangeHealthStats() {
  const { network } = useCurrentNetwork();
  const [stats, setStats] = useState<ExchangeStats | null>(null);
  const [sparks, setSparks] = useState<Sparklines | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setError(null);
      const response = await fetch(`${API_URL}${withNetwork("/api/analytics/exchange-stats")}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch stats');
      }
      
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Error fetching exchange stats:', err);
      setError('Failed to load stats');
      
      // Fallback: try to fetch directly from BULK API
      try {
        const bulkResponse = await fetch('https://exchange-api.bulk.trade/api/v1/stats?period=1d');
        if (bulkResponse.ok) {
          const bulkData = await bulkResponse.json();
          
          // Calculate totals from markets
          let volume24h = 0;
          let openInterest = 0;
          
          if (bulkData.markets) {
            for (const market of bulkData.markets) {
              volume24h += market.quoteVolume || 0;
              openInterest += (market.openInterest || 0) * (market.markPrice || 0);
            }
          }
          
          // Use totalUsd if available
          if (bulkData.openInterest?.totalUsd) {
            openInterest = bulkData.openInterest.totalUsd;
          }
          
          setStats({
            volume24h,
            // BULK reports one-sided OI; ×2 for the two-sided (long+short) total.
            openInterest: openInterest * 2,
            activeTraders: 0, // Not available from BULK API directly
            liquidations24h: 0,
            timestamp: bulkData.timestamp || Date.now(),
          });
          setError(null);
        }
      } catch (fallbackErr) {
        console.error('Fallback also failed:', fallbackErr);
      }
    } finally {
      setLoading(false);
    }
  };

  // Sparkline trends — a separate, non-blocking fetch. If it fails the cards
  // just render without a trend line (graceful), never an error.
  const fetchSparks = async () => {
    try {
      const res = await fetch(`${API_URL}${withNetwork('/api/analytics/dashboard-sparklines')}`);
      if (res.ok) setSparks(await res.json());
    } catch {
      /* sparklines are an enhancement, not a blocker */
    }
  };

  useEffect(() => {
    fetchStats();
    fetchSparks();

    // Refresh every 30 seconds
    const interval = setInterval(() => { fetchStats(); fetchSparks(); }, 30000);
    return () => clearInterval(interval);
  }, [network]);

  // Four exchange KPIs, rendered through the shared StatCard so they match
  // every other KPI strip in the app. Values stay neutral because absolute
  // magnitudes aren't directional; colour is spent only where it points.
  const cards: {
    label: string;
    raw: number;
    format: (n: number) => string;
    spark: SparkKey;
  }[] = [
    { label: '24h Volume', raw: stats?.volume24h ?? 0, format: formatNumber, spark: 'volume24h' },
    { label: 'Open Interest', raw: stats?.openInterest ?? 0, format: formatNumber, spark: 'openInterest' },
    { label: 'Active Traders', raw: stats?.activeTraders ?? 0, format: formatCount, spark: 'activeTraders' },
    { label: '24h Liquidations', raw: stats?.liquidations24h ?? 0, format: formatNumber, spark: 'liquidations24h' },
  ];

  return (
    <>
      {cards.map((c, i) => {
        const series = sparks?.[c.spark]?.series ?? [];
        return (
          <StatCard
            key={c.label}
            label={c.label}
            loading={loading}
            interactive
            className="animate-row-enter"
            style={{ '--row-index': i } as React.CSSProperties}
            value={<AnimatedNumber value={c.raw} format={c.format} />}
            chart={series.length >= 2 ? <Sparkline data={series} /> : undefined}
          />
        );
      })}
    </>
  );
}
