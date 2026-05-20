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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 animate-pulse">
            <div className="h-4 w-24 bg-[var(--bg-secondary-20)] rounded mb-2" />
            <div className="h-8 w-32 bg-[var(--bg-secondary-20)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 24H Volume */}
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-4 h-4 text-bulk-green" />
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">24H Volume</span>
        </div>
        <p className="text-2xl font-bold text-bulk-green">
          {formatNumber(stats?.volume24h)}
        </p>
      </div>

      {/* Open Interest */}
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Open Interest</span>
        </div>
        <p className="text-2xl font-bold text-blue-400">
          {formatNumber(stats?.openInterest)}
        </p>
      </div>

      {/* Active Traders */}
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-purple-400" />
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">Active Traders</span>
        </div>
        <p className="text-2xl font-bold text-[var(--text-primary)]">
          {formatCount(stats?.activeTraders)}
        </p>
      </div>

      {/* 24H Liquidations */}
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Flame className="w-4 h-4 text-red-400" />
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">24H Liquidations</span>
        </div>
        <p className="text-2xl font-bold text-red-400">
          {formatNumber(stats?.liquidations24h)}
        </p>
      </div>
    </div>
  );
}
