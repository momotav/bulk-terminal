'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { leaderboard, formatAddress, formatCompact, formatNumber, cn, type LeaderboardEntry } from '@/lib/api';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { BulkAvatar } from '@/components/BulkAvatar';
import type { TimeFrame } from '@/store';

export type BoardType = 'pnl' | 'active' | 'liquidated' | 'whales';

const CONFIG: Record<BoardType, { label: string; value: string; color: string; note: string }> = {
  pnl: { label: 'PnL', value: 'Net PnL', color: 'var(--pos)', note: 'Net of fees and funding. Live for the most active traders.' },
  active: { label: 'Volume', value: 'Volume', color: 'var(--accent)', note: 'Both sides of every fill count, like BULK’s own portfolio.' },
  liquidated: { label: 'Liquidations', value: 'Liquidated', color: 'var(--neg)', note: 'Value of positions closed by liquidation.' },
  whales: { label: 'Positions', value: 'Open notional', color: 'var(--accent)', note: 'Largest open positions right now.' },
};

const money = (n: number, signed = false) => `${signed ? (n >= 0 ? '+' : '−') : ''}$${formatCompact(Math.abs(n))}`;

/** The full leaderboard: podium for the top three, then the ranked list. */
export function LeaderboardBoard({ type, timeframe }: { type: BoardType; timeframe: TimeFrame }) {
  const { network } = useCurrentNetwork();
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const cfg = CONFIG[type];

  useEffect(() => {
    let alive = true;
    setRows(null);
    const load = type === 'pnl' ? leaderboard.getTopPnL(timeframe, 100)
      : type === 'liquidated' ? leaderboard.getMostLiquidated(timeframe, 100)
      : type === 'whales' ? leaderboard.getWhales(100)
      : leaderboard.getMostActive(timeframe, 100);
    load.then((d) => { if (alive) setRows(d ?? []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [type, timeframe, network]);

  const max = useMemo(() => Math.max(1, ...(rows ?? []).map((r) => Math.abs(r.value))), [rows]);
  const signed = type === 'pnl';
  const colorOf = (v: number) => (type === 'pnl' ? (v >= 0 ? 'var(--pos)' : 'var(--neg)') : cfg.color);

  if (rows === null) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-[132px] animate-pulse rounded-2xl bg-[var(--bg-muted)]" />)}</div>
        <div className="h-[420px] animate-pulse rounded-2xl bg-[var(--bg-muted)]" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-6 py-16 text-center">
        <p className="text-[15px] text-[var(--text-primary)]">Nothing to rank in this window yet</p>
        <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">Try a longer time range.</p>
      </div>
    );
  }

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="space-y-4">
      {/* podium */}
      <div className="grid gap-3 md:grid-cols-3">
        {podium.map((r, i) => (
          <Link key={r.wallet_address} href={`/wallet/${r.wallet_address}`} prefetch={false}
            className="group relative overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] [background-image:var(--surface-gradient)] p-4 transition-colors hover:border-[var(--text-tertiary)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BulkAvatar seed={r.wallet_address} size={40} />
                <div>
                  <div className="font-mono text-[13px] text-[var(--text-primary)]">{formatAddress(r.wallet_address)}</div>
                  <div className="text-[11px] tabular-nums text-[var(--text-tertiary)]">{r.trades ? `${formatNumber(r.trades, 0)} trades` : cfg.label}</div>
                </div>
              </div>
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium tabular-nums',
                i === 0 ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'bg-[var(--bg-base)] text-[var(--text-secondary)]')}>{i + 1}</span>
            </div>
            <div className="mt-4 text-[11px] text-[var(--text-tertiary)]">{cfg.value}</div>
            <div className="text-[26px] font-medium leading-tight tabular-nums" style={{ color: colorOf(r.value) }}>{money(r.value, signed)}</div>
          </Link>
        ))}
      </div>

      {/* the rest */}
      {rest.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)]">
          <div className="sticky top-0 z-10 grid grid-cols-[44px_minmax(0,1fr)_90px_120px] items-center gap-3 border-b border-[var(--border-color)] bg-[var(--bg-muted)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)] md:grid-cols-[44px_minmax(0,1fr)_110px_minmax(0,200px)_130px]">
            <span>Rank</span><span>Wallet</span><span className="text-right">Trades</span><span className="hidden md:block" /><span className="text-right">{cfg.value}</span>
          </div>
          {rest.map((r, idx) => (
            <Link key={r.wallet_address} href={`/wallet/${r.wallet_address}`} prefetch={false}
              className="grid grid-cols-[44px_minmax(0,1fr)_90px_120px] items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-[13px] transition-colors last:border-b-0 hover:bg-[var(--bg-base)] md:grid-cols-[44px_minmax(0,1fr)_110px_minmax(0,200px)_130px]">
              <span className="tabular-nums text-[var(--text-tertiary)]">{idx + 4}</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <BulkAvatar seed={r.wallet_address} size={24} />
                <span className="truncate font-mono text-[12px] text-[var(--text-primary)]">{formatAddress(r.wallet_address)}</span>
              </span>
              <span className="text-right tabular-nums text-[var(--text-secondary)]">{r.trades ? formatNumber(r.trades, 0) : '—'}</span>
              <span className="hidden md:block">
                <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--bg-base)]">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%`, background: colorOf(r.value), opacity: 0.75 }} />
                </span>
              </span>
              <span className="text-right font-medium tabular-nums" style={{ color: colorOf(r.value) }}>{money(r.value, signed)}</span>
            </Link>
          ))}
        </div>
      )}
      <p className="px-1 text-[11px] text-[var(--text-tertiary)]">{cfg.note}</p>
    </div>
  );
}
