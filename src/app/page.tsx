'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, Anchor } from 'lucide-react';
import { ExchangeHealthStats } from '@/components/ExchangeHealth';
import { NetworkHealthStats } from '@/components/NetworkHealthStats';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { BulkLeaderboardTable } from '@/components/leaderboard/BulkLeaderboardTable';
import { RecentActivity } from '@/components/RecentActivity';
import { userApi, formatAddress, formatCompact, type UserSearchResult } from '@/lib/api';

// X (Twitter) icon component
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export default function HomePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      setShowResults(false);
      router.push(`/whales/${query}`);
      setSearchQuery('');
    }
  };

  const handleSelectResult = (walletAddress: string) => {
    setShowResults(false);
    setSearchQuery('');
    router.push(`/whales/${walletAddress}`);
  };

  return (
    <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
      {/* Search Bar */}
      <form onSubmit={handleSearch}>
        <div className="relative" ref={searchRef}>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            placeholder="Search wallet address or @username..."
            className="w-full pl-12 pr-4 py-3 text-base bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl text-[var(--text-primary)] placeholder-text-secondary focus:outline-none focus:border-bulk-green transition-colors"
          />
          
          {/* Loading indicator */}
          {searching && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <Loader2 className="w-5 h-5 text-[var(--text-secondary)] animate-spin" />
            </div>
          )}

          {/* Search Results Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl shadow-xl z-50 max-h-80 overflow-y-auto">
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
                        <span className={Number(result.total_pnl) >= 0 ? 'text-green-400' : 'text-red-400'}>
                          PnL: {Number(result.total_pnl) >= 0 ? '+' : ''}${formatCompact(result.total_pnl)}
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
        </div>
      </form>

      {/* Exchange Health Stats — trading economics: 24h volume, OI,
          active traders, liquidations. Sourced from BULK trading API. */}
      <ExchangeHealthStats />

      {/* Network Health Stats — chain throughput: TPS, APS, latest
          round, connection status. Sourced from BULK's explorer node
          via a persistent WS connection on our backend. Updates every
          ~3s; numbers feel alive because BULK is fast. */}
      <NetworkHealthStats />

      {/* Leaderboards Grid.
          The Top Traders panel uses BULK's official indexer (matches
          bulk.trade ranks exactly — critical during the tournament).
          Liquidations, Whales, and Recent Activity stay on our DB since
          BULK's indexer only covers the winners side. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[450px]">
          <BulkLeaderboardTable limit={10} />
        </div>
        <div className="h-[450px]">
          <LeaderboardTable type="liquidated" limit={10} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-[450px]">
          {/* Whale Watch — BULK indexer's volume ranking, all-time. The
              old DB-backed version only saw wallets we'd collected stats
              for (often missed real top-volume traders); BULK's indexer
              is authoritative across every wallet on the exchange. */}
          <BulkLeaderboardTable
            limit={10}
            defaultMetric="volume"
            defaultWindow="all"
            allowMetricChange={false}
            title="Whale Watch"
            icon={Anchor}
          />
        </div>
        <div className="h-[450px]">
          <RecentActivity />
        </div>
      </div>
    </main>
  );
}
