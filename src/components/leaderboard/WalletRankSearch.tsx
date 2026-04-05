'use client';

import { useState } from 'react';
import { Search, Trophy, Flame, Activity, TrendingUp, X, Loader2 } from 'lucide-react';
import { leaderboard, formatCompact, formatAddress, type WalletRankData } from '@/lib/api';
import { cn } from '@/lib/api';
import Link from 'next/link';

export function WalletRankSearch() {
  const [wallet, setWallet] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WalletRankData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!wallet || wallet.length < 32) {
      setError('Please enter a valid wallet address');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await leaderboard.getWalletRank(wallet);
      setResult(data);
      if (!data.found) {
        setError('Wallet not found in our database. Try trading on BULK first!');
      }
    } catch (err) {
      setError('Failed to fetch wallet rank. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setWallet('');
    setResult(null);
    setError(null);
  };

  const getPercentile = (rank: number, total: number) => {
    const percentile = ((total - rank + 1) / total) * 100;
    return percentile.toFixed(1);
  };

  const getRankColor = (rank: number, total: number) => {
    const percentile = (rank / total) * 100;
    if (percentile <= 1) return 'text-yellow-400'; // Top 1%
    if (percentile <= 5) return 'text-bulk-green'; // Top 5%
    if (percentile <= 10) return 'text-bulk-blue'; // Top 10%
    if (percentile <= 25) return 'text-bulk-purple'; // Top 25%
    return 'text-[var(--text-secondary)]';
  };

  return (
    <div className="glass-card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-4 h-4 text-bulk-green" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Find Your Rank</h3>
      </div>

      {/* Search Input */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter wallet address..."
            className="w-full bg-[var(--bg-secondary-20)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-text-secondary focus:outline-none focus:border-bulk-green/50 font-mono"
          />
          {wallet && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !wallet}
          className="px-4 py-2 bg-bulk-green text-dark-primary rounded-lg text-sm font-medium hover:bg-bulk-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          Search
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-3 bg-bulk-red/10 border border-bulk-red/20 rounded-lg mb-4">
          <p className="text-sm text-bulk-red">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && result.found && (
        <div className="space-y-4">
          {/* Wallet Info */}
          <div className="flex items-center justify-between pb-3 border-b border-[var(--border-color)]">
            <div>
              <p className="text-xs text-[var(--text-secondary)] mb-1">Wallet</p>
              <Link 
                href={`/whales/${result.wallet_address}`}
                className="font-mono text-sm text-bulk-green hover:underline"
              >
                {formatAddress(result.wallet_address)}
              </Link>
            </div>
            <Link
              href={`/whales/${result.wallet_address}`}
              className="text-xs text-[var(--text-secondary)] hover:text-bulk-green transition-colors"
            >
              View Profile →
            </Link>
          </div>

          {/* Rankings Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Volume Rank */}
            {result.rankings.volume && (
              <div className="bg-[var(--bg-secondary-20)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-bulk-green" />
                  <span className="text-xs text-[var(--text-secondary)]">Volume</span>
                </div>
                <p className={cn("text-lg font-bold", getRankColor(result.rankings.volume.rank, result.rankings.volume.total))}>
                  #{result.rankings.volume.rank.toLocaleString()}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  of {result.rankings.volume.total.toLocaleString()} • Top {getPercentile(result.rankings.volume.rank, result.rankings.volume.total)}%
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  ${formatCompact(result.rankings.volume.value)}
                </p>
              </div>
            )}

            {/* PnL Rank */}
            {result.rankings.pnl && (
              <div className="bg-[var(--bg-secondary-20)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-xs text-[var(--text-secondary)]">PnL</span>
                </div>
                <p className={cn("text-lg font-bold", getRankColor(result.rankings.pnl.rank, result.rankings.pnl.total))}>
                  #{result.rankings.pnl.rank.toLocaleString()}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  of {result.rankings.pnl.total.toLocaleString()} • Top {getPercentile(result.rankings.pnl.rank, result.rankings.pnl.total)}%
                </p>
                <p className={cn("text-xs mt-1", result.rankings.pnl.value >= 0 ? 'text-bulk-green' : 'text-bulk-red')}>
                  {result.rankings.pnl.value >= 0 ? '+' : ''}${formatCompact(result.rankings.pnl.value)}
                </p>
              </div>
            )}

            {/* Trades Rank */}
            {result.rankings.trades && (
              <div className="bg-[var(--bg-secondary-20)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Activity className="w-3.5 h-3.5 text-bulk-purple" />
                  <span className="text-xs text-[var(--text-secondary)]">Trades</span>
                </div>
                <p className={cn("text-lg font-bold", getRankColor(result.rankings.trades.rank, result.rankings.trades.total))}>
                  #{result.rankings.trades.rank.toLocaleString()}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  of {result.rankings.trades.total.toLocaleString()} • Top {getPercentile(result.rankings.trades.rank, result.rankings.trades.total)}%
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  {result.rankings.trades.value.toLocaleString()} trades
                </p>
              </div>
            )}

            {/* Liquidations Rank */}
            {result.rankings.liquidations ? (
              <div className="bg-[var(--bg-secondary-20)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Flame className="w-3.5 h-3.5 text-bulk-red" />
                  <span className="text-xs text-[var(--text-secondary)]">Liquidations</span>
                </div>
                <p className={cn("text-lg font-bold", getRankColor(result.rankings.liquidations.rank, result.rankings.liquidations.total))}>
                  #{result.rankings.liquidations.rank.toLocaleString()}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  of {result.rankings.liquidations.total.toLocaleString()} rekt
                </p>
                <p className="text-xs text-bulk-red mt-1">
                  -${formatCompact(result.rankings.liquidations.value)}
                </p>
              </div>
            ) : (
              <div className="bg-[var(--bg-secondary-20)] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Flame className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span className="text-xs text-[var(--text-secondary)]">Liquidations</span>
                </div>
                <p className="text-lg font-bold text-bulk-green">None! 🎉</p>
                <p className="text-xs text-[var(--text-secondary)]">No liquidations yet</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
