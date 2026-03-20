'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Anchor, Eye, Star, StarOff, AlertCircle } from 'lucide-react';
import { LeaderboardTable } from '@/components/LeaderboardTable';
import { formatAddress } from '@/lib/api';
import { useStore } from '@/store';
import { usePrivy } from '@privy-io/react-auth';

export default function WhalesPage() {
  const router = useRouter();
  const { following } = useStore();
  const { authenticated } = usePrivy();
  
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

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary mb-1 flex items-center gap-2">
            <Anchor className="w-6 h-6 text-bulk-green" />
            Whale Tracker
          </h1>
          <p className="text-sm text-text-secondary">
            Track any wallet on BULK Exchange. View positions, PnL history, and trading activity.
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="bg-dark-secondary border border-dark-border rounded-lg p-4">
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
                  className="w-full pl-10 pr-4 py-2 bg-dark-tertiary border border-dark-border rounded-lg text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-bulk-green"
                />
              </div>
              <button
                type="submit"
                disabled={searching || !searchAddress.trim()}
                className="px-4 py-2 bg-bulk-green text-dark-primary rounded-lg font-medium flex items-center gap-2 text-sm hover:bg-bulk-green/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {searching ? (
                  <div className="w-4 h-4 border-2 border-dark-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    Track
                  </>
                )}
              </button>
            </div>
            
            {error && (
              <div className="flex items-center gap-2 mt-2 text-red-400 text-xs">
                <AlertCircle className="w-3 h-3" />
                {error}
              </div>
            )}
          </div>
        </form>

        {/* Following List */}
        {authenticated && following.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-400" />
              Following ({following.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {following.map((wallet) => (
                <button
                  key={wallet.wallet_address}
                  onClick={() => router.push(`/whales/${wallet.wallet_address}`)}
                  className="bg-dark-secondary border border-dark-border rounded-lg p-3 flex items-center gap-3 hover:border-bulk-green transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bulk-green to-bulk-green/50 flex items-center justify-center text-dark-primary text-xs font-bold shrink-0">
                    {wallet.wallet_address.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-text-primary block truncate">
                      {wallet.nickname || formatAddress(wallet.wallet_address)}
                    </span>
                    {wallet.total_pnl !== undefined && (
                      <span className={`text-xs ${(wallet.total_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        PnL: ${((wallet.total_pnl || 0) / 1000).toFixed(1)}K
                      </span>
                    )}
                  </div>
                </button>
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
