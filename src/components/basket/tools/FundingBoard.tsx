'use client';

import { useEffect, useMemo, useState } from 'react';
import { analytics, cn } from '@/lib/api';
import { STOCK_COINS } from '@/lib/coins';
import { dock } from '@/lib/basket';
import { CoinIcon } from '@/components/CoinIcon';
import { price } from '../parts';

type T = { symbol: string; fundingRate: number; markPrice: number; openInterest: number };
// BULK pays funding every hour on the hour (verified from account funding history).
const nextHour = () => { const d = new Date(); d.setMinutes(60, 0, 0); return d.getTime(); };
const pct = (r: number, dp = 4) => `${r >= 0 ? '+' : '−'}${Math.abs(r * 100).toFixed(dp)}%`;

/**
 * Funding for every market: the hourly rate, what it is a year, and the countdown to
 * the next payment. Positive means longs pay shorts. Click a market to chart it.
 */
export function FundingBoard() {
  const [rows, setRows] = useState<T[] | null>(null);
  const [sort, setSort] = useState<'high' | 'low' | 'name'>('high');
  const [cls, setCls] = useState<'all' | 'crypto' | 'stock'>('all');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = () => analytics.getTickersBulk().then((d) => { if (alive) setRows((d?.tickers ?? []).filter((t) => t.markPrice > 0 && t.openInterest > 0) as T[]); }).catch(() => {});
    load();
    const a = window.setInterval(load, 30_000), b = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; window.clearInterval(a); window.clearInterval(b); };
  }, []);

  const list = useMemo(() => (rows ?? [])
    .map((t) => ({ ...t, coin: t.symbol.replace(/-USD$/, '') }))
    .filter((t) => cls === 'all' || (cls === 'stock') === STOCK_COINS.includes(t.coin))
    .sort((a, b) => (sort === 'name' ? a.coin.localeCompare(b.coin) : sort === 'high' ? b.fundingRate - a.fundingRate : a.fundingRate - b.fundingRate)), [rows, sort, cls]);
  const left = Math.max(0, nextHour() - now);
  const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
  const max = Math.max(1e-9, ...list.map((t) => Math.abs(t.fundingRate)));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
        <div className="text-[11px] text-[var(--text-tertiary)]">Next payment in <span className="font-medium tabular-nums text-[var(--text-primary)]">{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</span></div>
        <div className="flex gap-1.5">
          <div className="flex rounded-lg bg-[var(--bg-muted)] p-0.5">
            {([['all', 'All'], ['crypto', 'Crypto'], ['stock', 'TradFi']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setCls(k)} className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', cls === k ? 'bg-[var(--bg-base)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>{l}</button>
            ))}
          </div>
          <div className="flex rounded-lg bg-[var(--bg-muted)] p-0.5">
            {([['high', 'Highest'], ['low', 'Lowest'], ['name', 'A–Z']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSort(k)} className={cn('rounded-md px-2 py-0.5 text-[11px] font-medium', sort === k ? 'bg-[var(--bg-base)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_90px_80px] gap-2 px-3 py-1 text-[10px] text-[var(--text-tertiary)]"><span>Market · mark</span><span className="text-right">Per hour</span><span className="text-right">APR</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null && <p className="px-3 py-8 text-center text-[12px] text-[var(--text-tertiary)]">Loading…</p>}
        {list.map((t) => {
          const up = t.fundingRate >= 0; const apr = t.fundingRate * 24 * 365;
          return (
            <button key={t.symbol} type="button" onClick={() => dock.openChart(t.coin)} title={`Open the ${t.coin} chart`}
              className="relative grid w-full grid-cols-[1fr_90px_80px] items-center gap-2 border-t border-[var(--border-color)] px-3 py-1.5 text-left text-[12px] hover:bg-[var(--bg-muted)]">
              <span className="pointer-events-none absolute inset-y-px left-0 opacity-60" style={{ width: `${(Math.abs(t.fundingRate) / max) * 35}%`, background: `rgb(var(${up ? '--pos-rgb' : '--neg-rgb'}) / 0.12)` }} />
              <span className="relative flex min-w-0 items-center gap-2">
                <CoinIcon symbol={t.coin} size={14} />
                <span className="font-medium text-[var(--text-primary)]">{t.coin}</span>
                <span className="truncate text-[11px] tabular-nums text-[var(--text-tertiary)]">{price(t.markPrice)}</span>
              </span>
              <span className="relative text-right tabular-nums" style={{ color: up ? 'var(--pos)' : 'var(--neg)' }}>{pct(t.fundingRate)}</span>
              <span className="relative text-right font-medium tabular-nums" style={{ color: up ? 'var(--pos)' : 'var(--neg)' }}>{pct(apr, 1)}</span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-[var(--border-color)] px-3 py-1.5 text-[10px] text-[var(--text-tertiary)]">Positive: longs pay shorts. APR = hourly rate × 24 × 365.</p>
    </div>
  );
}
