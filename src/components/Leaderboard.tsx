'use client';

import { useState, useEffect } from 'react';
import { Trophy, Flame, Medal, Crown, Skull } from 'lucide-react';
import { formatCompact, formatAddress, timeAgo, cn } from '@/lib/api';
import type { LeaderboardEntry } from '@/types';

// Mock data generator for demo (in real app, this would come from API)
function generateMockLeaderboard(): LeaderboardEntry[] {
  const addresses = [
    '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    '3fMBoKjBBM9GxCaGJa9WQjRiQhPVnXDhpJdW7kQ7FWHB',
    'FhVo8a6tcrXXVgALZGvhwXXHxLpJqGwqKsmBkxMHcJdK',
    '5ZWj7a1f8tWkjBErmMyN9ZavJULYDpBfMdRvFVkgKEcB',
    '2YxJvSJLGhfEgJKPHR7Vq4zVrqaELkYPZXdtPT1qMk7Y',
  ];

  return addresses.map((addr, i) => ({
    rank: i + 1,
    address: addr,
    totalLiquidations: Math.floor(Math.random() * 50) + 5,
    totalValue: Math.random() * 500000 + 10000,
    largestLiq: Math.random() * 100000 + 5000,
    lastLiqTime: Date.now() - Math.random() * 86400000 * 7,
  })).sort((a, b) => b.totalValue - a.totalValue);
}

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [timeframe, setTimeframe] = useState<'24h' | '7d' | 'all'>('24h');

  useEffect(() => {
    // In real app, fetch from API based on timeframe
    setEntries(generateMockLeaderboard());
  }, [timeframe]);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-yellow-400" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-300" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />;
      default:
        return <Skull className="w-4 h-4 text-gray-500" />;
    }
  };

  const getRankBg = (rank: number) => {
    switch (rank) {
      case 1:
        return 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30';
      case 2:
        return 'bg-gradient-to-r from-gray-400/20 to-gray-300/20 border-gray-400/30';
      case 3:
        return 'bg-gradient-to-r from-amber-600/20 to-orange-600/20 border-amber-600/30';
      default:
        return 'bg-dark-tertiary/50 border-dark-border';
    }
  };

  return (
    <div className="glass-card h-full flex flex-col">
      <div className="panel-header">
        <h2 className="panel-title">
          <span className="w-6 h-6 rounded-md bg-bulk-orange/20 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-bulk-orange" />
          </span>
          Liquidation Leaderboard
        </h2>
        
        {/* Timeframe selector */}
        <div className="flex gap-1 bg-dark-tertiary rounded-lg p-1">
          {(['24h', '7d', 'all'] as const).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                timeframe === tf
                  ? "bg-bulk-orange text-dark-primary"
                  : "text-gray-400 hover:text-white"
              )}
            >
              {tf === 'all' ? 'All Time' : tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 border-b border-dark-border sticky top-0 bg-dark-secondary/95 backdrop-blur-sm">
          <div className="col-span-1">#</div>
          <div className="col-span-4">Trader</div>
          <div className="col-span-2 text-right">Liqs</div>
          <div className="col-span-3 text-right">Total Rekt</div>
          <div className="col-span-2 text-right">Last</div>
        </div>

        {/* Entries */}
        {entries.map((entry, i) => (
          <div
            key={entry.address}
            className={cn(
              "grid grid-cols-12 gap-2 px-4 py-3 items-center border-b transition-all hover:bg-dark-tertiary/30",
              getRankBg(entry.rank)
            )}
          >
            {/* Rank */}
            <div className="col-span-1 flex items-center">
              {getRankIcon(entry.rank)}
            </div>

            {/* Address */}
            <div className="col-span-4">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                  entry.rank <= 3 
                    ? "bg-gradient-to-br from-bulk-orange to-bulk-red text-white"
                    : "bg-dark-border text-gray-400"
                )}>
                  {entry.address.slice(0, 2)}
                </div>
                <span className="font-mono text-sm truncate">
                  {formatAddress(entry.address)}
                </span>
              </div>
            </div>

            {/* Number of liquidations */}
            <div className="col-span-2 text-right">
              <span className="inline-flex items-center gap-1 text-bulk-red">
                <Flame className="w-3 h-3" />
                {entry.totalLiquidations}
              </span>
            </div>

            {/* Total Value */}
            <div className="col-span-3 text-right">
              <span className="font-display font-bold text-bulk-orange">
                ${formatCompact(entry.totalValue)}
              </span>
            </div>

            {/* Last liquidation */}
            <div className="col-span-2 text-right text-xs text-gray-500">
              {timeAgo(entry.lastLiqTime)}
            </div>
          </div>
        ))}

        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Trophy className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-sm">No liquidations in this period</p>
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="px-4 py-3 border-t border-dark-border bg-dark-tertiary/30">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">
            Total Rekt ({timeframe}):
          </span>
          <span className="font-display font-bold text-bulk-red">
            ${formatCompact(entries.reduce((sum, e) => sum + e.totalValue, 0))}
          </span>
        </div>
      </div>
    </div>
  );
}
