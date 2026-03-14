'use client';

import { TrendingUp, Activity, DollarSign, Percent } from 'lucide-react';
import { formatCompact, formatNumber, cn } from '@/lib/api';
import type { Ticker } from '@/types';

interface StatsCardsProps {
  tickers: Ticker[];
}

export function StatsCards({ tickers }: StatsCardsProps) {
  const totalVolume = tickers.reduce((sum, t) => sum + (t.quoteVolume || t.volume || 0), 0);
  const totalOI = tickers.reduce((sum, t) => sum + (t.openInterest || 0), 0);
  const avgFunding = tickers.length > 0 
    ? tickers.reduce((sum, t) => sum + (t.fundingRate || 0), 0) / tickers.length 
    : 0;
  const marketsUp = tickers.filter(t => (t.priceChangePercent || 0) >= 0).length;

  const stats = [
    {
      label: '24h Volume',
      value: `$${formatCompact(totalVolume)}`,
      icon: DollarSign,
      color: 'text-bulk-cyan',
      bgColor: 'bg-bulk-cyan/10',
      borderColor: 'border-bulk-cyan/30',
    },
    {
      label: 'Open Interest',
      value: `$${formatCompact(totalOI)}`,
      icon: Activity,
      color: 'text-bulk-magenta',
      bgColor: 'bg-bulk-magenta/10',
      borderColor: 'border-bulk-magenta/30',
    },
    {
      label: 'Avg Funding (8h)',
      value: `${(avgFunding * 100).toFixed(4)}%`,
      icon: Percent,
      color: avgFunding >= 0 ? 'text-bulk-green' : 'text-bulk-red',
      bgColor: avgFunding >= 0 ? 'bg-bulk-green/10' : 'bg-bulk-red/10',
      borderColor: avgFunding >= 0 ? 'border-bulk-green/30' : 'border-bulk-red/30',
    },
    {
      label: 'Markets Trend',
      value: `${marketsUp}/${tickers.length} Up`,
      icon: TrendingUp,
      color: marketsUp > tickers.length / 2 ? 'text-bulk-green' : 'text-bulk-red',
      bgColor: marketsUp > tickers.length / 2 ? 'bg-bulk-green/10' : 'bg-bulk-red/10',
      borderColor: marketsUp > tickers.length / 2 ? 'border-bulk-green/30' : 'border-bulk-red/30',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <div
          key={i}
          className={cn(
            "glass-card p-4 border",
            stat.borderColor
          )}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", stat.bgColor)}>
              <stat.icon className={cn("w-5 h-5", stat.color)} />
            </div>
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              {stat.label}
            </span>
          </div>
          <p className={cn("font-display text-2xl font-bold", stat.color)}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
