'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Eye, Star, AlertCircle, Loader2 } from 'lucide-react';
import { BulkLeaderboardTable } from '@/components/leaderboard/BulkLeaderboardTable';
import { formatAddress, userApi, formatCompact, cn, type UserSearchResult } from '@/lib/api';
import { useStore } from '@/store';
import { usePrivy } from '@privy-io/react-auth';
import { Anchor } from 'lucide-react';

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
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = searchQuery.trim();

    // If it looks like a full wallet address, don't search — let them submit.
    if (query.length >= 32) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

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
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setShowResults(false);
    setError('');
    router.push(`/whales/${searchQuery.trim()}`);
  };

  const handleSelectResult = (walletAddress: string) => {
    setShowResults(false);
    setSearchQuery('');
    router.push(`/whales/${walletAddress}`);
  };

  return (
    <main className="responsive-container py-6 space-y-6">
      {/* Header — calm sentence-case heading, matching the rest of the app. */}
      <header>
        <h1 className="page-title text-[var(--role-content)]">Whale tracker</h1>
        <p className="mt-1 text-[13px] text-[var(--role-content-muted)]">
          Track any wallet on BULK Exchange - search by address or X handle.
        </p>
      </header>

      {/* Search — a flat field (no heavy box), mirroring the dashboard. */}
      <form onSubmit={handleSearch}>
        <div className="flex gap-2">
          <div className="relative flex-1" ref={searchRef}>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--role-content-subtle)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder="Enter a wallet address or @username…"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)] py-2.5 pl-11 pr-10 text-sm text-[var(--role-content)] placeholder-[var(--role-content-subtle)] transition-colors duration-200 hover:border-[var(--role-line-subtle)] focus:border-[var(--role-chrome)] focus:outline-none"
            />

            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--role-content-subtle)]" />
              </div>
            )}

            {/* Result dropdown — floats above the page, so it earns a shadow. */}
            {showResults && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)] shadow-[var(--shadow-lg)]">
                {searchResults.map((result) => (
                  <button
                    key={result.wallet_address}
                    type="button"
                    onClick={() => handleSelectResult(result.wallet_address)}
                    className="flex w-full items-center gap-3 border-b border-[var(--role-line-subtle)] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[var(--role-surface-raised)]"
                  >
                    {result.twitter_avatar ? (
                      <img
                        src={result.twitter_avatar}
                        alt=""
                        className="h-10 w-10 rounded-full border border-[var(--role-line)]"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.15)] text-sm font-bold text-[var(--role-chrome)]">
                        {result.wallet_address.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {result.twitter_name && (
                          <span className="truncate font-medium text-[var(--role-content)]">
                            {result.twitter_name}
                          </span>
                        )}
                        {result.twitter_handle && (
                          <span className="flex items-center gap-1 text-sm text-[var(--role-content-muted)]">
                            <XIcon className="h-3 w-3" />@{result.twitter_handle}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--role-content-subtle)]">
                        <span className="font-mono">{formatAddress(result.wallet_address)}</span>
                        {result.total_pnl !== undefined && result.total_pnl !== null && (
                          <span
                            className="tabular-nums"
                            style={{ color: result.total_pnl >= 0 ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)' }}
                          >
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
          </div>

          <button
            type="submit"
            disabled={!searchQuery.trim()}
            className="flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] bg-bulk-accent px-4 py-2.5 text-sm font-medium transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: 'var(--accent-text)' }}
          >
            <Eye className="h-4 w-4" />
            Track
          </button>
        </div>

        {error && (
          <div className="mt-2 flex items-center gap-2 text-xs text-[var(--role-signal-negative)]">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}
      </form>

      {/* Following — calmer card rows for wallets the user tracks. */}
      {authenticated && following.length > 0 && (
        <section>
          <h2 className="t-h2 mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 text-[var(--role-chrome)]" />
            Following <span className="text-[var(--role-content-subtle)]">({following.length})</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {following.map((wallet) => (
              <button
                key={wallet.wallet_address}
                onClick={() => router.push(`/whales/${wallet.wallet_address}`)}
                className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--role-line)] bg-[var(--role-surface)] p-3 text-left transition-colors hover:border-[var(--role-line-subtle)]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.15)] text-xs font-bold text-[var(--role-chrome)]">
                  {wallet.wallet_address.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs text-[var(--role-content)]">
                    {wallet.nickname || formatAddress(wallet.wallet_address)}
                  </span>
                  {wallet.total_pnl !== undefined && (
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: (wallet.total_pnl || 0) >= 0 ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)' }}
                    >
                      PnL: ${((wallet.total_pnl || 0) / 1000).toFixed(1)}K
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Top whales + top traders — sourced from BULK's indexer volume /
          PnL rankings (authoritative across all addresses on the exchange). */}
      <section aria-label="Rankings">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            <BulkLeaderboardTable
              limit={15}
              defaultMetric="realized_pnl"
              defaultWindow="24h"
              allowMetricChange={false}
              title="Top Traders"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
