'use client';

import { useEffect, useState } from 'react';
import { Activity, DollarSign, Flame, Users } from 'lucide-react';
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
      label: '24H VOLUME',
      value: health ? `$${formatCompact(health.total_volume_24h)}` : '—',
      icon: DollarSign,
      color: 'text-bulk-green',
    },
    {
      label: 'OPEN INTEREST',
      value: health ? `$${formatCompact(health.total_open_interest)}` : '—',
      icon: Activity,
      color: 'text-bulk-blue',
    },
    {
      label: 'ACTIVE TRADERS',
      value: health ? formatCompact(health.total_traders) : '—',
      icon: Users,
      color: 'text-bulk-purple',
    },
    {
      label: '24H LIQUIDATIONS',
      value: health ? `$${formatCompact(health.liquidation_value_24h)}` : '—',
      icon: Flame,
      color: 'text-bulk-red',
    },
  ];

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="stat-card animate-pulse">
            <div className="h-3 w-20 bg-dark-tertiary rounded mb-3" />
            <div className="h-10 w-24 bg-dark-tertiary rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat, i) => (
        <div key={i} className="stat-card">
          <div className="flex items-center gap-2 mb-2">
            <stat.icon className={cn("w-4 h-4", stat.color)} />
            <span className="text-[11px] font-medium text-text-secondary tracking-wide">{stat.label}</span>
          </div>
          <p className={cn("text-4xl font-bold text-right", stat.color)}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
