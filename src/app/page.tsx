'use client';

import { Header } from '@/components/Header';
import { ExchangeHealthStats } from '@/components/ExchangeHealth';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { RecentActivity } from '@/components/RecentActivity';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        {/* Exchange Health Stats */}
        <ExchangeHealthStats />

        {/* Leaderboards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-[450px]">
            <LeaderboardTable type="pnl" limit={10} />
          </div>
          <div className="h-[450px]">
            <LeaderboardTable type="liquidated" limit={10} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-[450px]">
            <LeaderboardTable type="whales" limit={10} showTimeframe={false} />
          </div>
          <div className="h-[450px]">
            <RecentActivity />
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <a
            href="https://alphanet.bulk.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 text-center hover:border-bulk-cyan/50 transition-colors group"
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-bulk-cyan/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-2xl">📈</span>
            </div>
            <p className="font-semibold text-sm">Trade</p>
            <p className="text-xs text-gray-500">Open BULK Exchange</p>
          </a>

          <a
            href="https://explorer.bulk.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 text-center hover:border-bulk-magenta/50 transition-colors group"
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-bulk-magenta/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-2xl">🔍</span>
            </div>
            <p className="font-semibold text-sm">Explorer</p>
            <p className="text-xs text-gray-500">View transactions</p>
          </a>

          <a
            href="https://exchange-api.bulk.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 text-center hover:border-bulk-green/50 transition-colors group"
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-bulk-green/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-2xl">📚</span>
            </div>
            <p className="font-semibold text-sm">API Docs</p>
            <p className="text-xs text-gray-500">Developer resources</p>
          </a>

          <a
            href="https://discord.gg/bulk"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 text-center hover:border-bulk-yellow/50 transition-colors group"
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-bulk-yellow/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <span className="text-2xl">💬</span>
            </div>
            <p className="font-semibold text-sm">Discord</p>
            <p className="text-xs text-gray-500">Join community</p>
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-dark-border py-6 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center text-sm text-gray-500">
          <p>
            Powered by <span className="gradient-text font-semibold">BULK Exchange</span> • 
            Decentralized Perpetual Futures on Solana
          </p>
        </div>
      </footer>
    </div>
  );
}
