'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { analytics, cn, formatAddress, formatCompact, type PositionChange } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';
import { BulkAvatar } from '@/components/BulkAvatar';
import { InfoTip } from '@/components/InfoTip';

const WINDOWS = [[15, '15m'], [60, '1h'], [240, '4h'], [1440, '24h'], [4320, '3d'], [10080, '7d']] as const;
const usd = (n: number) => `$${formatCompact(Math.abs(n))}`;
const coinOf = (s: string) => s.replace(/-USD$/, '');
const KIND: Record<PositionChange['kind'], string> = { opened: 'Opened', closed: 'Closed', added: 'Added to', reduced: 'Cut', flipped: 'Flipped to' };
type Data = Awaited<ReturnType<typeof analytics.getPositionChanges>>;

/**
 * What the top traders did over a window: who opened, added, cut, closed or
 * flipped, biggest first, and the net long/short change per market.
 */
export function PositionChanges({ isIn }: { isIn: (coin: string) => boolean }) {
  const [win, setWin] = useState<number>(60);
  const [side, setSide] = useState<'all' | 'long' | 'short'>('all');
  const [data, setData] = useState<Data | null>(null);
  const [shown, setShown] = useState(12);

  useEffect(() => {
    let alive = true; setData(null); setShown(12);
    const load = () => analytics.getPositionChanges(win).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData((x) => x ?? { window: win, from: null, to: null, total: 0, changes: [], markets: [] }); });
    load(); const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [win]);

  const changes = useMemo(() => (data?.changes ?? []).filter((c) => isIn(coinOf(c.symbol)) && (side === 'all' || c.side === side)), [data, isIn, side]);
  const markets = useMemo(() => (data?.markets ?? []).filter((m) => isIn(coinOf(m.symbol))).slice(0, 12), [data, isIn]);
  const maxNet = Math.max(1, ...markets.map((m) => Math.abs(m.longAdded - m.shortAdded)));
  const fmtT = (t: number) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const label = WINDOWS.find(([w]) => w === win)?.[1];

  return (
    <div className="glass-card p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-[var(--text-primary)]">
            Position changes
            <InfoTip label="About position changes" width={320}>
              Each top trader’s positions now vs {label} ago, from snapshots every 5 minutes. A change counts when the size moved
              (not just the price) by at least $500. Short-lived trades opened and closed inside the window don’t show.
            </InfoTip>
          </h2>
          {data?.from && data.to && <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{fmtT(data.from)} → {fmtT(data.to)} · {data.total} changes</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="toggle-group">
            {(['all', 'long', 'short'] as const).map((s) => <button key={s} type="button" onClick={() => setSide(s)} className={cn('toggle-btn', side === s && 'active')}>{s === 'all' ? 'All' : s === 'long' ? 'Longs' : 'Shorts'}</button>)}
          </div>
          <div className="toggle-group">
            {WINDOWS.map(([w, l]) => <button key={w} type="button" onClick={() => setWin(w)} className={cn('toggle-btn', win === w && 'active')}>{l}</button>)}
          </div>
        </div>
      </div>

      {!data ? <div className="h-[260px] animate-pulse rounded-xl bg-[var(--bg-base)]" /> : !data.from ? (
        <p className="py-10 text-center text-[13px] text-[var(--text-tertiary)]">Snapshots started recently. Changes over {label} show once there’s {label} of history.</p>
      ) : (
        <div key={`${win}-${side}`} className="grid animate-[chart-fade_.35s_ease-out] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
          {/* net per market */}
          <div>
            <div className="mb-2 text-[12px] text-[var(--text-secondary)]">Net change by market</div>
            {markets.length === 0 && <p className="text-[12px] text-[var(--text-tertiary)]">No changes in this window.</p>}
            <div className="space-y-1">
              {markets.map((m) => {
                const net = m.longAdded - m.shortAdded; // + = traders got more long
                const w = (Math.abs(net) / maxNet) * 50;
                return (
                  <div key={m.symbol} className="grid grid-cols-[64px_minmax(0,1fr)_96px] items-center gap-2 py-1 text-[12px] tabular-nums" title={`Longs ${m.longAdded >= 0 ? '+' : '−'}${usd(m.longAdded)} · shorts ${m.shortAdded >= 0 ? '+' : '−'}${usd(m.shortAdded)} · ${m.wallets} wallet${m.wallets === 1 ? '' : 's'}`}>
                    <span className="flex items-center gap-1.5 text-[var(--text-primary)]"><CoinIcon symbol={coinOf(m.symbol)} size={14} />{coinOf(m.symbol)}</span>
                    <span className="relative h-2">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-color)]" />
                      <span className="absolute inset-y-0 rounded-full transition-all duration-700 ease-out"
                        style={net >= 0 ? { left: '50%', width: `${w}%`, background: 'var(--pos)' } : { right: '50%', width: `${w}%`, background: 'var(--neg)' }} />
                    </span>
                    <span className="text-right" style={{ color: net >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{usd(net)} {net >= 0 ? 'long' : 'short'}</span>
                  </div>
                );
              })}
            </div>
            {markets.length > 0 && <div className="mt-2 flex justify-between text-[10px] text-[var(--text-tertiary)]"><span>← more short</span><span>more long →</span></div>}
          </div>

          {/* the changes */}
          <div className="min-w-0">
            <div className="mb-2 text-[12px] text-[var(--text-secondary)]">Biggest moves</div>
            {changes.length === 0 && <p className="text-[12px] text-[var(--text-tertiary)]">Nothing matches.</p>}
            <div className="divide-y divide-[var(--border-color)]">
              {changes.slice(0, shown).map((c, i) => {
                const target = c.kind === 'flipped' || c.kind === 'opened' || c.kind === 'added' ? c.side : c.sizeBefore > 0 ? 'long' : 'short';
                const tone = target === 'long' ? 'var(--pos)' : 'var(--neg)';
                return (
                  <div key={`${c.wallet}-${c.symbol}`} style={{ '--row-index': i } as React.CSSProperties}
                    className="animate-row-enter grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 text-[13px] sm:grid-cols-[150px_minmax(0,1fr)_auto]">
                    <span className="min-w-0">
                      <Link href={`/wallet/${c.wallet}`} className="flex min-w-0 items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <BulkAvatar seed={c.wallet} size={20} round /><span className="truncate tabular-nums">{formatAddress(c.wallet)}</span>
                      </Link>
                      <span className="mt-0.5 flex items-center gap-1 pl-7 text-[12px] sm:hidden">
                        <span className="text-[var(--text-tertiary)]">{KIND[c.kind]}</span><span style={{ color: tone }}>{target}</span>
                        <span className="text-[var(--text-primary)]">{coinOf(c.symbol)}</span>
                      </span>
                    </span>
                    <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
                      <span className="text-[var(--text-secondary)]">{KIND[c.kind]}</span>
                      <span style={{ color: tone }}>{target}</span>
                      <CoinIcon symbol={coinOf(c.symbol)} size={14} className="ml-1" />
                      <span className="truncate text-[var(--text-primary)]">{coinOf(c.symbol)}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="text-[var(--text-primary)]">{usd(c.deltaUsd)}</span>
                      <span className="block text-[11px] text-[var(--text-tertiary)]">{c.notionalNow > 0 ? `now ${usd(c.notionalNow)}` : 'flat'}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            {changes.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + 12)} className="mt-2 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Show more ({changes.length - shown})</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
