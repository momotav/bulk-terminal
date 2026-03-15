'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Anchor, Eye, Star, StarOff, AlertCircle } from 'lucide-react';
import { Header } from '@/components/Header';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { wallet, formatAddress, cn } from '@/lib/api';
import { useStore } from '@/store';

export default function WhalesPage() {
  const router = useRouter();
  const { watchlist, addToWatchlist, removeFromWatchlist, user } = useStore();
  
  const [searchAddress, setSearchAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchAddress.trim()) return;

    setSearching(true);
    setError('');

    try {
      router.push(`/whales/${searchAddress.trim()}`);
    } catch (err) {
      setError('Failed to search wallet.');
    } finally {
      setSearching(false);
    }
  };

  const handleWatchlistToggle = async (address: string) => {
    if (!user) {
      router.push('/login');
      return;
    }

    const isWatched = watchlist.includes(address);
    
    try {
      if (isWatched) {
        await wallet.removeFromWatchlist(address);
        removeFromWatchlist(address);
      } else {
        await wallet.addToWatchlist(address);
        addToWatchlist(address);
      }
    } catch (err) {
      console.error('Failed to update watchlist:', err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary mb-1 flex items-center gap-2">
            <Anchor className="w-6 h-6 text-bulk-blue" />
            Whale Tracker
          </h1>
          <p className="text-sm text-text-secondary">
            Track any wallet on BULK Exchange. View positions, PnL history, and trading activity.
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="glass-card p-4">
            <label className="block text-xs uppercase tracking-wider text-text-secondary mb-2">
              Search Wallet Address
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <input
                  type="text"
                  value={searchAddress}
                  onChange={(e) => setSearchAddress(e.target.value)}
                  placeholder="Enter Solana wallet address..."
                  className="input pl-10 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={searching || !searchAddress.trim()}
                className="btn-primary px-4 flex items-center gap-2 text-sm"
              >
                {searching ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    Track
                  </>
                )}
              </button>
            </div>
            
            {error && (
              <div className="flex items-center gap-2 mt-2 text-bulk-red text-xs">
                <AlertCircle className="w-3 h-3" />
                {error}
              </div>
            )}
          </div>
        </form>

        {/* Watchlist */}
        {user && watchlist.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-bulk-orange" />
              Your Watchlist
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {watchlist.map((address) => (
                <div
                  key={address}
                  className="glass-card p-3 flex items-center justify-between hover:border-bulk-green transition-colors"
                >
                  <button
                    onClick={() => router.push(`/whales/${address}`)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bulk-green to-bulk-blue flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {address.slice(0, 2)}
                    </div>
                    <span className="font-mono text-xs text-text-primary truncate">
                      {formatAddress(address)}
                    </span>
                  </button>
                  <button
                    onClick={() => handleWatchlistToggle(address)}
                    className="p-1.5 hover:bg-dark-tertiary rounded transition-colors text-bulk-orange"
                  >
                    <StarOff className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Whales */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-[500px]">
            <LeaderboardTable type="whales" limit={15} showTimeframe={false} />
          </div>
          <div className="h-[500px]">
            <LeaderboardTable type="pnl" limit={15} />
          </div>
        </div>
      </main>
    </div>
  );
}
