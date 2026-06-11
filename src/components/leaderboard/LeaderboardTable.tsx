'use client';

import { useEffect, useState } from 'react';
import { Trophy, Flame, Anchor, Activity, Crown, Medal } from 'lucide-react';
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
    valueLabel: 'PnL',
    valuePrefix: '$',
  },
  liquidated: {
    title: 'Hall of Shame',
    subtitle: 'Most Liquidated',
    icon: Flame,
    color: 'text-bulk-red',
    valueLabel: 'Rekt Value',
    valuePrefix: '$',
  },
  whales: {
    title: 'Whale Watch',
    subtitle: 'Biggest Positions',
    icon: Anchor,
    color: 'text-bulk-blue',
    valueLabel: 'Notional',
    valuePrefix: '$',
  },
  active: {
    title: 'Most Active',
    subtitle: 'By Trade Count',
    icon: Activity,
    color: 'text-bulk-purple',
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
    if (rank === 1) return <Crown className="w-4 h-4 text-bulk-orange" />;
    if (rank === 2) return <Medal className="w-4 h-4 text-[var(--text-secondary)]" />;
    if (rank === 3) return <Medal className="w-4 h-4 text-bulk-orange/70" />;
    return <span className="text-[var(--text-secondary)] font-mono text-xs">#{rank}</span>;
  };

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <config.icon className={cn("w-4 h-4", config.color)} />
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{config.title}</h2>
          </div>
        </div>

        {showTimeframe && type !== 'whales' && (
          <div className="toggle-group">
            {(['24h', '7d', '30d', 'all'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "toggle-btn",
                  timeframe === tf && "active"
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
          <div className="p-3 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse p-2">
                <div className="w-6 h-6 bg-[var(--bg-secondary-20)] rounded" />
                <div className="flex-1">
                  <div className="h-3 w-20 bg-[var(--bg-secondary-20)] rounded" />
                </div>
                <div className="h-4 w-16 bg-[var(--bg-secondary-20)] rounded" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)]">
            <config.icon className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">No data yet</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-border/30">
            {data.map((entry) => (
              <Link
                key={entry.wallet_address}
                href={`/whales/${entry.wallet_address}`}
                prefetch={false}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-secondary-20)]/50 transition-colors"
              >
                {/* Rank */}
                <div className="w-6 flex justify-center">
                  {getRankIcon(entry.rank)}
                </div>

                {/* Address */}
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs text-[var(--text-primary)] truncate">
                    {formatAddress(entry.wallet_address)}
                  </span>
                  {entry.trades && (
                    <p className="text-[10px] text-[var(--text-secondary)]">
                      {entry.trades} trades
                    </p>
                  )}
                </div>

                {/* Value */}
                <div className="text-right">
                  <p className={cn("font-sans text-sm font-bold", config.color)}>
                    {config.valuePrefix}{formatCompact(entry.value)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {data.length > 0 && (
        <div className="px-4 py-2.5 border-t border-[var(--border-color)]">
          <Link
            href={`/leaderboard?type=${type}`}
            className="text-xs text-bulk-green hover:text-bulk-green/80 transition-colors"
          >
            View full leaderboard →
          </Link>
        </div>
      )}
    </div>
  );
}
