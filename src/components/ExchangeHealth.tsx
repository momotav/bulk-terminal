'use client';

import { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, Users, Flame, RefreshCw } from 'lucide-react';
import { withNetwork } from '@/lib/network';

interface ExchangeStats {
  volume24h: number;
  openInterest: number;
  activeTraders: number;
  liquidations24h: number;
  timestamp: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

export function ExchangeHealthStats() {
  const [stats, setStats] = useState<ExchangeStats | null>(null);
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
            openInterest,
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

  useEffect(() => {
    fetchStats();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

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

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 animate-pulse">
            <div className="h-3 w-20 bg-[var(--bg-secondary-20)] rounded mb-3" />
            <div className="h-7 w-28 bg-[var(--bg-secondary-20)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  // Each stat carries a left accent rail in its own color so the band has
  // direction and rhythm instead of four identical floating boxes. Volume
  // is the headline metric for an exchange, so it gets visual primacy via
  // a brighter rail + slightly larger value.
  const cards = [
    {
      label: '24h Volume',
      value: formatNumber(stats?.volume24h),
      icon: DollarSign,
      color: 'var(--bids)',
      valueClass: 'text-bulk-green',
      hero: true,
    },
    {
      label: 'Open Interest',
      value: formatNumber(stats?.openInterest),
      icon: TrendingUp,
      color: '#60a5fa',
      valueClass: 'text-blue-400',
    },
    {
      label: 'Active Traders',
      value: formatCount(stats?.activeTraders),
      icon: Users,
      color: '#c084fc',
      valueClass: 'text-[var(--text-primary)]',
    },
    {
      label: '24h Liquidations',
      value: formatNumber(stats?.liquidations24h),
      icon: Flame,
      color: 'var(--asks)',
      valueClass: 'text-red-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className="relative overflow-hidden bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg pl-4 pr-3 py-3.5 hover:border-[var(--border-secondary)] transition-colors"
          >
            {/* Left accent rail — the card's color identity. */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[3px]"
              style={{ backgroundColor: c.color, opacity: c.hero ? 1 : 0.55 }}
            />
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className="w-3.5 h-3.5" style={{ color: c.color }} />
              <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-[0.12em] font-medium">
                {c.label}
              </span>
            </div>
            <p className={`${c.hero ? 'text-[28px]' : 'text-2xl'} font-bold tabular-nums tracking-tight leading-none ${c.valueClass}`}>
              {c.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
