'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Activity, DollarSign, Flame, Users } from 'lucide-react';
import { analytics, formatCompact, cn, type ExchangeHealth } from '@/lib/api';

export function ExchangeHealthStats() {
  const [health, setHealth] = useState<ExchangeHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const data = await analytics.getExchangeHealth();
        setHealth(data);
      } catch (error) {
        console.error('Failed to fetch exchange health:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const stats = [
    {
      label: '24h Volume',
      value: health ? `$${formatCompact(health.total_volume_24h)}` : '—',
      icon: DollarSign,
      color: 'text-bulk-cyan',
      bgColor: 'bg-bulk-cyan/10',
    },
    {
      label: 'Open Interest',
      value: health ? `$${formatCompact(health.total_open_interest)}` : '—',
      icon: Activity,
      color: 'text-bulk-magenta',
      bgColor: 'bg-bulk-magenta/10',
    },
    {
      label: 'Active Traders',
      value: health ? formatCompact(health.total_traders) : '—',
      icon: Users,
      color: 'text-bulk-green',
      bgColor: 'bg-bulk-green/10',
    },
    {
      label: '24h Liquidations',
      value: health ? `$${formatCompact(health.liquidation_value_24h)}` : '—',
      icon: Flame,
      color: 'text-bulk-red',
      bgColor: 'bg-bulk-red/10',
      subValue: health ? `${health.total_liquidations_24h} rekt` : '',
    },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-4 animate-pulse">
            <div className="h-10 w-10 bg-dark-tertiary rounded-xl mb-3" />
            <div className="h-4 w-20 bg-dark-tertiary rounded mb-2" />
            <div className="h-8 w-24 bg-dark-tertiary rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <div key={i} className="glass-card p-4">
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
          {stat.subValue && (
            <p className="text-xs text-gray-500 mt-1">{stat.subValue}</p>
          )}
        </div>
      ))}
    </div>
  );
}
