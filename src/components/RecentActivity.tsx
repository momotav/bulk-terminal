'use client';

import { useEffect, useState } from 'react';
import { Flame, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { leaderboard, formatCompact, formatAddress, timeAgo, cn } from '@/lib/api';

interface ActivityItem {
  id: number;
  type: 'liquidation' | 'trade';
  wallet_address: string | null;
  symbol: string;
  side: string;
  size: number;
  price: number;
  value: number;
  timestamp: string;
}

export function RecentActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'liquidations' | 'trades'>('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [liqs, trades] = await Promise.all([
          leaderboard.getRecentLiquidations(20),
          leaderboard.getRecentTrades(20),
        ]);

        const combined: ActivityItem[] = [
          ...(liqs as ActivityItem[]).map((l) => ({ 
            ...l, 
            type: 'liquidation' as const,
            price: parseFloat(l.price as any) || 0,
            value: parseFloat(l.value as any) || 0,
            size: parseFloat(l.size as any) || 0,
          })),
          ...(trades as ActivityItem[]).map((t) => ({ 
            ...t, 
            type: 'trade' as const,
            price: parseFloat(t.price as any) || 0,
            value: parseFloat(t.value as any) || 0,
            size: parseFloat(t.size as any) || 0,
          })),
        ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        setActivities(combined);
      } catch (error) {
        console.error('Failed to fetch activity:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const filtered = activities.filter((a) => {
    if (tab === 'all') return true;
    if (tab === 'liquidations') return a.type === 'liquidation';
    if (tab === 'trades') return a.type === 'trade';
    return true;
  });

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-purple/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-bulk-purple" />
          </span>
          Live Activity
        </h2>

        <div className="flex gap-1 bg-dark-tertiary rounded-lg p-1">
          {(['all', 'liquidations', 'trades'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-2 py-1 text-[10px] font-medium rounded capitalize transition-all",
                tab === t
                  ? "bg-bulk-teal text-dark-primary"
                  : "text-gray-400 hover:text-white"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-10 h-10 bg-dark-tertiary rounded-xl" />
                <div className="flex-1">
                  <div className="h-4 w-32 bg-dark-tertiary rounded mb-1" />
                  <div className="h-3 w-20 bg-dark-tertiary rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Zap className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No recent activity</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-border/50">
            {filtered.slice(0, 20).map((item) => (
              <div
                key={`${item.type}-${item.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-dark-tertiary/30 transition-colors"
              >
                {/* Icon */}
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                  item.type === 'liquidation'
                    ? "bg-bulk-coral/15 text-bulk-coral"
                    : item.side === 'buy'
                    ? "bg-bulk-teal/15 text-bulk-teal"
                    : "bg-bulk-coral/15 text-bulk-coral"
                )}>
                  {item.type === 'liquidation' ? (
                    <Flame className="w-5 h-5" />
                  ) : item.side === 'buy' ? (
                    <TrendingUp className="w-5 h-5" />
                  ) : (
                    <TrendingDown className="w-5 h-5" />
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                      item.type === 'liquidation'
                        ? "bg-bulk-coral/20 text-bulk-coral"
                        : item.side === 'buy'
                        ? "bg-bulk-teal/20 text-bulk-teal"
                        : "bg-bulk-coral/20 text-bulk-coral"
                    )}>
                      {item.type === 'liquidation' ? 'REKT' : item.side.toUpperCase()}
                    </span>
                    <span className="font-semibold text-sm">{item.symbol}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {item.wallet_address ? formatAddress(item.wallet_address) : 'Unknown'} • {timeAgo(item.timestamp)}
                  </p>
                </div>

                {/* Value */}
                <div className="text-right shrink-0">
                  <p className={cn(
                    "font-display font-bold text-sm",
                    item.type === 'liquidation' ? "text-bulk-coral" : "text-white"
                  )}>
                    ${formatCompact(item.value)}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    @ ${item.price.toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
