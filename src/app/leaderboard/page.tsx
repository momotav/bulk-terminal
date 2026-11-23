'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LeaderboardBoard, type BoardType } from '@/components/leaderboard/LeaderboardBoard';
import { WalletRankSearch } from '@/components/leaderboard/WalletRankSearch';
import { cn } from '@/lib/api';
import type { TimeFrame } from '@/store';

const TABS: { id: BoardType; label: string }[] = [
  { id: 'pnl', label: 'PnL' },
  { id: 'active', label: 'Volume' },
  { id: 'liquidated', label: 'Liquidations' },
  { id: 'whales', label: 'Positions' },
];
const VALID: BoardType[] = ['pnl', 'active', 'liquidated', 'whales'];
const TIMEFRAMES: [TimeFrame, string][] = [['24h', '24H'], ['7d', '7D'], ['30d', '30D'], ['all', 'All']];

function LeaderboardContent() {
  // Deep links: /leaderboard?type=liquidated opens that board.
  const searchParams = useSearchParams();
  const initial = (() => { const t = searchParams.get('type'); return t && VALID.includes(t as BoardType) ? (t as BoardType) : 'pnl'; })();
  const [tab, setTab] = useState<BoardType>(initial);
  // 7D by default: a single day is too sparse for some boards (liquidations).
  const [timeframe, setTimeframe] = useState<TimeFrame>('7d');
  // PnL is a running total; Positions is a live snapshot. Neither has a window.
  const windowed = tab === 'active' || tab === 'liquidated';

  return (
    <main className="flex-1 responsive-container py-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="page-title mb-1 text-[var(--text-primary)]">Leaderboard</h1>
          <p className="text-[14px] text-[var(--text-secondary)]">The top traders on BULK by PnL, volume, liquidations and open positions.</p>
        </div>
        <WalletRankSearch />
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)]">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('relative px-3.5 pb-3 pt-1 text-[14px] transition-colors',
                tab === t.id ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
              {t.label}
              {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--text-primary)]" />}
            </button>
          ))}
        </div>
        <div className={cn('mb-2 flex rounded-lg bg-[var(--bg-muted)] p-0.5 transition-opacity', !windowed && 'pointer-events-none opacity-40')} title={windowed ? undefined : 'This board is all-time / live'}>
          {TIMEFRAMES.map(([v, l]) => (
            <button key={v} type="button" onClick={() => setTimeframe(v)}
              className={cn('rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
                timeframe === v && windowed ? 'bg-[var(--bg-base)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>{l}</button>
          ))}
        </div>
      </div>

      <LeaderboardBoard type={tab} timeframe={windowed ? timeframe : 'all'} />
    </main>
  );
}

export default function LeaderboardPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-base)]">
      <Suspense fallback={<main className="flex-1 responsive-container py-8" />}>
        <LeaderboardContent />
      </Suspense>
    </div>
  );
}
