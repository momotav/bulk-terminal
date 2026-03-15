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
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-bulk-orange" />
          <h2 className="text-sm font-semibold text-text-primary">Live Activity</h2>
        </div>

        <div className="toggle-group">
          {(['all', 'liquidations', 'trades'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "toggle-btn capitalize",
                tab === t && "active"
              )}
            >
              {t === 'liquidations' ? 'Liqs' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-3 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse p-2">
                <div className="w-8 h-8 bg-dark-tertiary rounded" />
                <div className="flex-1">
                  <div className="h-3 w-24 bg-dark-tertiary rounded mb-1" />
                  <div className="h-2 w-16 bg-dark-tertiary rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
            <Zap className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">No recent activity</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-border/30">
            {filtered.slice(0, 20).map((item) => (
              <div
                key={`${item.type}-${item.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-dark-tertiary/50 transition-colors"
              >
                {/* Icon */}
                <div className={cn(
                  "w-8 h-8 rounded flex items-center justify-center shrink-0",
                  item.type === 'liquidation'
                    ? "bg-bulk-red/10 text-bulk-red"
                    : item.side === 'buy'
                    ? "bg-bulk-green/10 text-bulk-green"
                    : "bg-bulk-red/10 text-bulk-red"
                )}>
                  {item.type === 'liquidation' ? (
                    <Flame className="w-4 h-4" />
                  ) : item.side === 'buy' ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn(
                      "text-[9px] font-bold uppercase px-1 py-0.5 rounded",
                      item.type === 'liquidation'
                        ? "bg-bulk-red/15 text-bulk-red"
                        : item.side === 'buy'
                        ? "bg-bulk-green/15 text-bulk-green"
                        : "bg-bulk-red/15 text-bulk-red"
                    )}>
                      {item.type === 'liquidation' ? 'REKT' : item.side.toUpperCase()}
                    </span>
                    <span className="font-medium text-xs text-text-primary">{item.symbol}</span>
                  </div>
                  <p className="text-[10px] text-text-secondary">
                    {item.wallet_address ? formatAddress(item.wallet_address) : 'Unknown'} • {timeAgo(item.timestamp)}
                  </p>
                </div>

                {/* Value */}
                <div className="text-right shrink-0">
                  <p className={cn(
                    "font-display font-bold text-xs",
                    item.type === 'liquidation' ? "text-bulk-red" : "text-text-primary"
                  )}>
                    ${formatCompact(item.value)}
                  </p>
                  <p className="text-[9px] text-text-secondary">
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
