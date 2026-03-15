'use client';

import { useEffect, useState } from 'react';
import { Trophy, Flame, Anchor, Activity, Crown, Medal, TrendingUp, TrendingDown } from 'lucide-react';
import { leaderboard, formatCompact, formatAddress, cn, type LeaderboardEntry } from '@/lib/api';
import { useStore } from '@/store';
import Link from 'next/link';

type LeaderboardType = 'pnl' | 'liquidated' | 'whales' | 'active';

interface LeaderboardTableProps {
  type: LeaderboardType;
  limit?: number;
  showTimeframe?: boolean;
}

const typeConfig = {
  pnl: {
    title: 'Top Traders',
    subtitle: 'Ranked by PnL',
    icon: Trophy,
    color: 'text-bulk-green',
    bgColor: 'bg-bulk-green/10',
    valueLabel: 'PnL',
    valuePrefix: '$',
  },
  liquidated: {
    title: 'Hall of Shame',
    subtitle: 'Most Liquidated',
    icon: Flame,
    color: 'text-bulk-red',
    bgColor: 'bg-bulk-red/10',
    valueLabel: 'Rekt Value',
    valuePrefix: '$',
  },
  whales: {
    title: 'Whale Watch',
    subtitle: 'Biggest Positions',
    icon: Anchor,
    color: 'text-bulk-cyan',
    bgColor: 'bg-bulk-cyan/10',
    valueLabel: 'Notional',
    valuePrefix: '$',
  },
  active: {
    title: 'Most Active',
    subtitle: 'By Trade Count',
    icon: Activity,
    color: 'text-bulk-yellow',
    bgColor: 'bg-bulk-yellow/10',
    valueLabel: 'Volume',
    valuePrefix: '$',
  },
};

export function LeaderboardTable({ type, limit = 10, showTimeframe = true }: LeaderboardTableProps) {
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { timeframe, setTimeframe } = useStore();

  const config = typeConfig[type];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        let result: LeaderboardEntry[];
        switch (type) {
          case 'pnl':
            result = await leaderboard.getTopPnL(timeframe, limit);
            break;
          case 'liquidated':
            result = await leaderboard.getMostLiquidated(timeframe, limit);
            break;
          case 'whales':
            result = await leaderboard.getWhales(limit);
            break;
          case 'active':
            result = await leaderboard.getMostActive(timeframe, limit);
            break;
        }
        setData(result);
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [type, timeframe, limit]);

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Crown className="w-5 h-5 text-yellow-400" />;
    if (rank === 2) return <Medal className="w-5 h-5 text-gray-300" />;
    if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" />;
    return <span className="text-gray-500 font-mono text-sm">#{rank}</span>;
  };

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", config.bgColor)}>
            <config.icon className={cn("w-4 h-4", config.color)} />
          </div>
          <div>
            <h2 className="font-display text-sm font-semibold">{config.title}</h2>
            <p className="text-[10px] text-gray-500">{config.subtitle}</p>
          </div>
        </div>

        {showTimeframe && type !== 'whales' && (
          <div className="flex gap-1 bg-dark-tertiary rounded-lg p-1">
            {(['24h', '7d', '30d', 'all'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "px-2 py-1 text-[10px] font-medium rounded transition-all",
                  timeframe === tf
                    ? "bg-bulk-cyan text-dark-primary"
                    : "text-gray-400 hover:text-white"
                )}
              >
                {tf === 'all' ? 'All' : tf.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-8 h-8 bg-dark-tertiary rounded-lg" />
                <div className="flex-1">
                  <div className="h-4 w-24 bg-dark-tertiary rounded mb-1" />
                  <div className="h-3 w-16 bg-dark-tertiary rounded" />
                </div>
                <div className="h-5 w-20 bg-dark-tertiary rounded" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <config.icon className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No data yet</p>
            <p className="text-xs mt-1">Check back later</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-border/50">
            {data.map((entry) => (
              <Link
                key={entry.wallet_address}
                href={`/whales/${entry.wallet_address}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-dark-tertiary/30 transition-colors"
              >
                {/* Rank */}
                <div className="w-8 flex justify-center">
                  {getRankIcon(entry.rank)}
                </div>

                {/* Address */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                      entry.rank <= 3 
                        ? "bg-gradient-to-br from-bulk-cyan to-bulk-magenta text-white"
                        : "bg-dark-border text-gray-400"
                    )}>
                      {entry.wallet_address.slice(0, 2)}
                    </div>
                    <span className="font-mono text-sm truncate">
                      {formatAddress(entry.wallet_address)}
                    </span>
                  </div>
                  {entry.trades && (
                    <p className="text-[10px] text-gray-500 ml-10">
                      {entry.trades} trades
                    </p>
                  )}
                </div>

                {/* Value */}
                <div className="text-right">
                  <p className={cn("font-display font-bold", config.color)}>
                    {config.valuePrefix}{formatCompact(entry.value)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {data.length > 0 && (
        <div className="px-4 py-3 border-t border-dark-border">
          <Link
            href={`/leaderboard?type=${type}`}
            className="text-xs text-bulk-cyan hover:text-bulk-cyan/80 transition-colors"
          >
            View full leaderboard →
          </Link>
        </div>
      )}
    </div>
  );
}
