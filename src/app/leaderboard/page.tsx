'use client';

import { useState } from 'react';
import { Trophy, Flame, Anchor, Activity } from 'lucide-react';
import { Header } from '@/components/Header';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { cn } from '@/lib/api';

type LeaderboardType = 'pnl' | 'liquidated' | 'whales' | 'active';

const tabs = [
  { id: 'pnl', label: 'Top Traders', icon: Trophy, color: 'text-bulk-green' },
  { id: 'liquidated', label: 'Most Liquidated', icon: Flame, color: 'text-bulk-red' },
  { id: 'whales', label: 'Whale Watch', icon: Anchor, color: 'text-bulk-cyan' },
  { id: 'active', label: 'Most Active', icon: Activity, color: 'text-bulk-yellow' },
] as const;

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<LeaderboardType>('pnl');

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold mb-2">Leaderboard</h1>
          <p className="text-gray-500">
            Track the top performers, biggest liquidations, and most active traders on BULK Exchange.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all",
                activeTab === tab.id
                  ? "bg-dark-tertiary border border-dark-border"
                  : "text-gray-400 hover:text-white hover:bg-dark-tertiary/50"
              )}
            >
              <tab.icon className={cn("w-4 h-4", activeTab === tab.id && tab.color)} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Leaderboard */}
        <div className="h-[600px]">
          <LeaderboardTable 
            type={activeTab} 
            limit={50} 
            showTimeframe={activeTab !== 'whales'} 
          />
        </div>
      </main>
    </div>
  );
}
