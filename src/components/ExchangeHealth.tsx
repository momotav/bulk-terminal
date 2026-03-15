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
    const interval = setInterval(fetchHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  const stats = [
    {
      label: '24h Volume',
      value: health ? `$${formatCompact(health.total_volume_24h)}` : '—',
      icon: DollarSign,
      color: 'text-bulk-green',
    },
    {
      label: 'Open Interest',
      value: health ? `$${formatCompact(health.total_open_interest)}` : '—',
      icon: Activity,
      color: 'text-bulk-blue',
    },
    {
      label: 'Active Traders',
      value: health ? formatCompact(health.total_traders) : '—',
      icon: Users,
      color: 'text-bulk-purple',
    },
    {
      label: '24h Liquidations',
      value: health ? `$${formatCompact(health.liquidation_value_24h)}` : '—',
      icon: Flame,
      color: 'text-bulk-red',
      subValue: health ? `${health.total_liquidations_24h} rekt` : '',
    },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="stat-card animate-pulse">
            <div className="h-3 w-16 bg-dark-tertiary rounded mb-2" />
            <div className="h-7 w-20 bg-dark-tertiary rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat, i) => (
        <div key={i} className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <stat.icon className={cn("w-3.5 h-3.5", stat.color)} />
            <span className="stat-label">{stat.label}</span>
          </div>
          <p className={cn("font-display text-xl font-bold", stat.color)}>
            {stat.value}
          </p>
          {stat.subValue && (
            <p className="text-[10px] text-text-secondary mt-0.5">{stat.subValue}</p>
          )}
        </div>
      ))}
    </div>
  );
}
