'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Header } from '@/components/Header';
import { ExchangeHealthStats } from '@/components/ExchangeHealth';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { RecentActivity } from '@/components/RecentActivity';

export default function HomePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      router.push(`/whales/${query}`);
      setSearchQuery('');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        {/* Search Bar */}
        <form onSubmit={handleSearch}>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search wallet address..."
              className="w-full pl-12 pr-4 py-3 text-base bg-dark-secondary border border-dark-border rounded-xl text-text-primary placeholder-text-secondary focus:outline-none focus:border-bulk-green transition-colors"
            />
          </div>
        </form>

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
