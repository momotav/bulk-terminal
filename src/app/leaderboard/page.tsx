'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Trophy, Flame, Anchor, Activity } from 'lucide-react';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { WalletRankSearch } from '@/components/leaderboard/WalletRankSearch';
import { cn } from '@/lib/api';
import type { TimeFrame } from '@/store';

type LeaderboardType = 'pnl' | 'liquidated' | 'whales' | 'active';

const tabs = [
  { id: 'pnl', label: 'PnL', icon: Trophy, color: 'text-bulk-green' },
  { id: 'liquidated', label: 'Liquidations', icon: Flame, color: 'text-bulk-red' },
  { id: 'whales', label: 'Positions', icon: Anchor, color: 'text-bulk-blue' },
  { id: 'active', label: 'Volume', icon: Activity, color: 'text-bulk-purple' },
] as const;

const VALID_TYPES: LeaderboardType[] = ['pnl', 'liquidated', 'whales', 'active'];

function LeaderboardContent() {
  // Deep-link support: /leaderboard?type=liquidated lands on that tab, so the
  // "View full leaderboard" links (and shared URLs) open the right board
  // instead of always resetting to PnL.
  const searchParams = useSearchParams();
  const initialType = (() => {
    const t = searchParams.get('type');
    return t && VALID_TYPES.includes(t as LeaderboardType) ? (t as LeaderboardType) : 'pnl';
  })();

  const [activeTab, setActiveTab] = useState<LeaderboardType>(initialType);
  // Page-local timeframe (NOT the shared store) so the full leaderboard can
  // default to 7d — 24h is too sparse here (e.g. only a handful of wallets get
  // liquidated in a day, which made the Liquidations board look empty).
  const [timeframe, setTimeframe] = useState<TimeFrame>('7d');

  return (
    <main className="flex-1 responsive-container py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="page-title text-[var(--text-primary)] mb-1">Leaderboard</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Track the top performers, biggest liquidations, and most active traders.
        </p>
      </div>

      {/* Wallet Rank Search */}
      <WalletRankSearch />

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border',
              activeTab === tab.id
                ? 'bg-[var(--bg-muted)] border-[var(--border-color)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)]',
            )}
          >
            <tab.icon className={cn('w-4 h-4', activeTab === tab.id && tab.color)} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Leaderboard — all tabs are served from OUR collected data (the
          `traders` table). Volume/whales/activity/liquidations come straight
          from the indexed trade feed; PnL is enriched every few minutes from
          BULK's public account endpoint for our top traders by volume. (We no
          longer use BULK's indexer leaderboard — it's disabled upstream.) */}
      <div className="h-[640px]">
        <LeaderboardTable
          type={activeTab}
          limit={100}
          showTimeframe={activeTab !== 'pnl' && activeTab !== 'whales'}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          hideFullLink
        />
      </div>
    </main>
  );
}

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <Suspense fallback={<main className="flex-1 responsive-container py-6" />}>
        <LeaderboardContent />
      </Suspense>
    </div>
  );
}
