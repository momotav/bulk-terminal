'use client';

import { useState } from 'react';
import { Trophy, Flame, Anchor, Activity } from 'lucide-react';
import { Header } from '@/components/Header';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { BulkLeaderboardTable } from '@/components/leaderboard/BulkLeaderboardTable';
import { WalletRankSearch } from '@/components/leaderboard/WalletRankSearch';
import { cn } from '@/lib/api';

type LeaderboardType = 'pnl' | 'liquidated' | 'whales' | 'active';

const tabs = [
  { id: 'pnl', label: 'Top Traders', icon: Trophy, color: 'text-bulk-green' },
  { id: 'liquidated', label: 'Most Liquidated', icon: Flame, color: 'text-bulk-red' },
  { id: 'whales', label: 'Whale Watch', icon: Anchor, color: 'text-bulk-blue' },
  { id: 'active', label: 'Most Active', icon: Activity, color: 'text-bulk-purple' },
] as const;

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<LeaderboardType>('pnl');

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">Leaderboard</h1>
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
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                activeTab === tab.id
                  ? "bg-[var(--bg-muted)] border-[var(--border-color)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)]"
              )}
            >
              <tab.icon className={cn("w-4 h-4", activeTab === tab.id && tab.color)} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Leaderboard.
            'pnl' is now sourced from BULK's official indexer so the ranks
            match bulk.trade exactly — critical for tournament viewing where
            streamers will flick between the two sites. The other three tabs
            stay on our DB-backed views (liquidations, whales, activity)
            since BULK's indexer doesn't expose those concepts. */}
        <div className="h-[600px]">
          {activeTab === 'pnl' ? (
            <BulkLeaderboardTable limit={50} />
          ) : (
            <LeaderboardTable
              type={activeTab}
              limit={50}
              showTimeframe={activeTab !== 'whales'}
            />
          )}
        </div>
      </main>
    </div>
  );
}
