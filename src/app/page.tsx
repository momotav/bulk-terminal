'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2 } from 'lucide-react';
import { ExchangeHealthStats } from '@/components/ExchangeHealth';
import { TelemetryPanel } from '@/components/TelemetryPanel';
import { RecentActivity } from '@/components/RecentActivity';
import { MarketTicker } from '@/components/MarketTicker';
import { MarketsTable } from '@/components/MarketsTable';
import { LiquidationBreakdown } from '@/components/LiquidationBreakdown';
import { userApi, formatAddress, formatCompact, cn, type UserSearchResult } from '@/lib/api';
import { useTickers } from '@/hooks/useTickers';

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

  // One ticker poll feeds both the strip and the markets table.
  const { tickers, loading: tickersLoading } = useTickers();

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
    /* LAYOUT
       Three zones, each with its own rhythm rather than one uniform
       stack:

         1. Command bar   search + network telemetry, side by side
         2. Overview      the KPI band
         3. Market        the two data panels

       Zones 1 and 2 are coupled (both are "state of the exchange right
       now") and sit 12px apart. Zone 3 opens a new idea and gets 32px
       plus a labelled masthead. Everything measures against
       .responsive-container, which runs to 120rem with fluid gutters -
       on any display up to 1920px the grid fills the viewport instead
       of stranding margin at the edges. */
    <main className="responsive-container flex-1 py-3 lg:py-4">
      {/* Market tape — every active perp, last price and 24h change,
          running full width across the very top, under the nav. */}
      <MarketTicker tickers={tickers} loading={tickersLoading} />

      {/* My own top-to-bottom layout, dressed in the BULK portfolio's
          feel - not its structure: a calm sentence-case heading, the wallet
          search as a clean field, the KPI card row, the Markets panel, then
          the activity panels. Flat bordered cards on a base a shade darker,
          low-noise colour, tabular numbers. Their vibe, my structure. */}
      <header className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="shrink-0">
          <h1 className="font-display text-2xl font-medium leading-none tracking-tight text-[var(--role-content)] sm:text-[28px]">
            Overview
          </h1>
          <p className="mt-1.5 text-[13px] text-[var(--role-content-muted)]">
            Real-time analytics for BULK Exchange
          </p>
        </div>
        <form onSubmit={handleSearch} className="w-full sm:flex-1">
        <div className="relative" ref={searchRef}>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--role-content-subtle)] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            placeholder="Search wallet address or @username..."
            className="w-full pl-11 pr-4 py-2.5 text-sm bg-[var(--role-surface)] border border-[var(--role-line)]
                       rounded-[var(--radius-sm)] text-[var(--role-content)] placeholder-[var(--role-content-subtle)]
                       focus:outline-none focus:border-[var(--role-chrome)]
                       hover:border-[var(--role-line-subtle)]
                       transition-colors duration-200 ease-[var(--ease-out)]"
          />
          
          {/* Loading indicator */}
          {searching && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <Loader2 className="w-5 h-5 text-[var(--text-secondary)] animate-spin" />
            </div>
          )}

          {/* Search Results Dropdown. The one place a shadow survives —
              this genuinely floats above the page, so it gets
              --shadow-lg. Square corners keep it in the family. */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--role-surface)] border border-[var(--role-line)] rounded-[var(--radius-sm)] shadow-[var(--shadow-lg)] z-50 max-h-80 overflow-y-auto">
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
                        <span className={cn('tabular-nums', Number(result.total_pnl) >= 0 ? 'text-positive' : 'text-negative')}>
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
      </header>

      {/* KPI card row — the four exchange stats, one calm flat row. Network
          throughput now lives in its own live-chart panel below, beside the
          Markets table. */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ExchangeHealthStats />
      </div>

      {/* Markets + telemetry — the markets table narrowed to 8/12 with the
          network telemetry graphed in the freed 4/12: a tabbed live chart
          of TPS / APS instead of plain KPI text. Stacks below lg. */}
      <section aria-label="Markets" className="mt-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="h-[480px] lg:col-span-8">
            <MarketsTable tickers={tickers} loading={tickersLoading} />
          </div>
          <div className="h-[480px] lg:col-span-4">
            <TelemetryPanel />
          </div>
        </div>
      </section>

      {/* Market activity — the live trade/liquidation feed beside the 24h
          liquidation split per market, 8/4 from lg.

          (The former Top Traders / Whale Watch / Hall of Shame ranking
          panels ran on BULK's official indexer leaderboard, disabled when
          the trading competition ended. These two run on our OWN collected
          data and work today.) */}
      <section aria-label="Market activity" className="mt-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="h-[420px] sm:h-[480px] lg:col-span-8">
            <RecentActivity />
          </div>
          <div className="h-[420px] sm:h-[480px] lg:col-span-4">
            <LiquidationBreakdown />
          </div>
        </div>
      </section>
    </main>
  );
}
