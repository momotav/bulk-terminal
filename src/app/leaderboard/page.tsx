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
  { id: 'whales', label: 'Whale Watch', icon: Anchor, color: 'text-bulk-blue' },
  { id: 'active', label: 'Most Active', icon: Activity, color: 'text-bulk-purple' },
] as const;

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<LeaderboardType>('pnl');

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary mb-1">Leaderboard</h1>
          <p className="text-sm text-text-secondary">
            Track the top performers, biggest liquidations, and most active traders.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                activeTab === tab.id
                  ? "bg-dark-secondary border-dark-border text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary hover:bg-dark-tertiary"
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
