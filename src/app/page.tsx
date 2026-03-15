'use client';

import { Header } from '@/components/Header';
import { ExchangeHealthStats } from '@/components/ExchangeHealth';
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable';
import { RecentActivity } from '@/components/RecentActivity';
import { ExternalLink } from 'lucide-react';

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

        {/* Quick Links */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <a
            href="https://alphanet.bulk.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 hover:border-bulk-green transition-colors group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-bulk-green/10 flex items-center justify-center">
                <span className="text-xl">📈</span>
              </div>
              <ExternalLink className="w-4 h-4 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="font-semibold text-sm text-text-primary">Trade</p>
            <p className="text-xs text-text-secondary">Open BULK Exchange</p>
          </a>

          <a
            href="https://explorer.bulk.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 hover:border-bulk-orange transition-colors group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-bulk-orange/10 flex items-center justify-center">
                <span className="text-xl">🔍</span>
              </div>
              <ExternalLink className="w-4 h-4 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="font-semibold text-sm text-text-primary">Explorer</p>
            <p className="text-xs text-text-secondary">View transactions</p>
          </a>

          <a
            href="https://exchange-api.bulk.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 hover:border-bulk-blue transition-colors group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-bulk-blue/10 flex items-center justify-center">
                <span className="text-xl">📚</span>
              </div>
              <ExternalLink className="w-4 h-4 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="font-semibold text-sm text-text-primary">API Docs</p>
            <p className="text-xs text-text-secondary">Developer resources</p>
          </a>

          <a
            href="https://discord.gg/bulk"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-4 hover:border-bulk-purple transition-colors group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-bulk-purple/10 flex items-center justify-center">
                <span className="text-xl">💬</span>
              </div>
              <ExternalLink className="w-4 h-4 text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="font-semibold text-sm text-text-primary">Discord</p>
            <p className="text-xs text-text-secondary">Join community</p>
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-dark-border py-5 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center text-xs text-text-secondary">
          <p>
            Powered by <span className="text-bulk-green font-semibold">BULK Exchange</span> • 
            Decentralized Perpetual Futures on Solana
          </p>
        </div>
      </footer>
    </div>
  );
}
