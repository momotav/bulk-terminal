'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Anchor, Eye, Star, AlertCircle, Loader2 } from 'lucide-react';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { BulkLeaderboardTable } from '@/components/leaderboard/BulkLeaderboardTable';
import { formatAddress, userApi, formatCompact, type UserSearchResult } from '@/lib/api';
import { useStore } from '@/store';
import { usePrivy } from '@privy-io/react-auth';

// X (Twitter) icon component
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export default function WhalesPage() {
  const router = useRouter();
  const { following } = useStore();
  const { authenticated } = usePrivy();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search for Twitter handles
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const query = searchQuery.trim();
    
    // If it looks like a full wallet address, don't search - let them submit
    if (query.length >= 32) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    // Search if 2+ characters
    if (query.length >= 2) {
      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const results = await userApi.search(query);
          setSearchResults(results);
          setShowResults(results.length > 0);
        } catch (err) {
          console.error('Search error:', err);
          setSearchResults([]);
        } finally {
          setSearching(false);
        }
      }, 300);
    } else {
      setSearchResults([]);
      setShowResults(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setShowResults(false);
    setError('');

    // Navigate to the wallet page
    router.push(`/whales/${searchQuery.trim()}`);
  };

  const handleSelectResult = (walletAddress: string) => {
    setShowResults(false);
    setSearchQuery('');
    router.push(`/whales/${walletAddress}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1 flex items-center gap-2">
            <Anchor className="w-6 h-6 text-bulk-green" />
            Whale Tracker
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Track any wallet on BULK Exchange. Search by wallet address or X handle.
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
            <label className="block text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2">
              Search Wallet Address or X Handle
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1" ref={searchRef}>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => searchResults.length > 0 && setShowResults(true)}
                  placeholder="Enter wallet address or @username..."
                  className="w-full pl-10 pr-4 py-2 bg-[var(--bg-secondary-20)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-text-tertiary focus:outline-none focus:border-bulk-green"
                />
                
                {/* Search Results Dropdown */}
                {showResults && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
                    {searchResults.map((result) => (
                      <button
                        key={result.wallet_address}
                        type="button"
                        onClick={() => handleSelectResult(result.wallet_address)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-secondary-20)] transition-colors text-left border-b border-[var(--border-color)] last:border-b-0"
                      >
                        {/* Avatar */}
                        {result.twitter_avatar ? (
                          <img 
                            src={result.twitter_avatar} 
                            alt="" 
                            className="w-10 h-10 rounded-full border border-[var(--border-color)]"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-bulk-green to-bulk-green/50 flex items-center justify-center text-dark-primary text-sm font-bold">
                            {result.wallet_address.slice(0, 2)}
                          </div>
                        )}
                        
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {result.twitter_name && (
                              <span className="font-medium text-[var(--text-primary)] truncate">
                                {result.twitter_name}
                              </span>
                            )}
                            {result.twitter_handle && (
                              <span className="flex items-center gap-1 text-[var(--text-secondary)] text-sm">
                                <XIcon className="w-3 h-3" />
                                @{result.twitter_handle}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
                            <span className="font-mono">{formatAddress(result.wallet_address)}</span>
                            {result.total_pnl !== undefined && result.total_pnl !== null && (
                              <span className={result.total_pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                                PnL: {result.total_pnl >= 0 ? '+' : ''}${formatCompact(result.total_pnl)}
                              </span>
                            )}
                            {result.total_volume !== undefined && result.total_volume !== null && (
                              <span>Vol: ${formatCompact(result.total_volume)}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Loading indicator */}
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 text-[var(--text-secondary)] animate-spin" />
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={!searchQuery.trim()}
                className="px-4 py-2 bg-bulk-green text-dark-primary rounded-lg font-medium flex items-center gap-2 text-sm hover:bg-bulk-green/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Eye className="w-4 h-4" />
                Track
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
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-400" />
              Following ({following.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {following.map((wallet) => (
                <button
                  key={wallet.wallet_address}
                  onClick={() => router.push(`/whales/${wallet.wallet_address}`)}
                  className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3 flex items-center gap-3 hover:border-bulk-green transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-bulk-green to-bulk-green/50 flex items-center justify-center text-dark-primary text-xs font-bold shrink-0">
                    {wallet.wallet_address.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-[var(--text-primary)] block truncate">
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

        {/* Top Whales — sourced from BULK indexer's volume ranking
            (was previously the DB-tracked leaderboard, which only saw
            wallets we'd already collected stats for and missed many real
            top-volume traders). The BULK indexer is authoritative across
            all addresses on the exchange. Locked to `volume` metric since
            this panel's whole point is "biggest whales by trade volume". */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-[500px]">
            <BulkLeaderboardTable
              limit={15}
              defaultMetric="volume"
              defaultWindow="all"
              allowMetricChange={false}
              title="Top Whales"
              icon={Anchor}
            />
          </div>
          <div className="h-[500px]">
            <LeaderboardTable type="pnl" limit={15} />
          </div>
        </div>
      </main>
    </div>
  );
}
