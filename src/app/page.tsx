'use client';

import { Header } from '@/components/Header';
import { ExchangeHealthStats } from '@/components/ExchangeHealth';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { RecentActivity } from '@/components/RecentActivity';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        {/* Exchange Health Stats */}
        <ExchangeHealthStats />

        {/* Leaderboards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-[450px]">
            <LeaderboardTable type="pnl" limit={10} />
          </div>
          <div className="h-[450px]">
            <LeaderboardTable type="liquidated" limit={10} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-[450px]">
            <LeaderboardTable type="whales" limit={10} showTimeframe={false} />
          </div>
          <div className="h-[450px]">
            <RecentActivity />
          </div>
        </div>
      </main>
    </div>
  );
}
