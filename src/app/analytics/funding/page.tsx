'use client';

import { useEffect, useMemo, useState } from 'react';
import { analytics, cn, type FundingPremiumRow } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { useAssetClass } from '@/hooks/useAssetClass';
import { AssetClassToggle } from '@/components/AssetClassToggle';
import { useAvailableCoins } from '@/hooks/useAvailableCoins';

const RANGES = [[7, '7D'], [30, '30D']] as const;
// BULK pays funding hourly; APR = hourly rate × 24 × 365.
const apr = (r: number | null) => (r === null ? null : r * 24 * 365 * 100);
const pct = (v: number | null, dp = 1) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dp)}%`);
const bp = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} bp`);
const tone = (v: number | null) => (v === null || Math.abs(v) < 1e-9 ? 'var(--text-secondary)' : v > 0 ? 'var(--pos)' : 'var(--neg)');

type SortKey = 'now' | 'avg' | 'premium' | 'flips' | 'name';

export default function FundingPage() {
  const [days, setDays] = useState<number>(7);
  const [rows, setRows] = useState<FundingPremiumRow[] | null>(null);
  const [sel, setSel] = useState<string>('BTC-USD');
  const [sort, setSort] = useState<SortKey>('now');
  const [series, setSeries] = useState<{ t: number; funding: number | null; premium: number | null }[] | null>(null);
  const { isIn } = useAssetClass();
  // Closed / suspended markets sit at BULK's default rate with no trading: leave them out.
  const { allMarkets } = useAvailableCoins();
  const inactive = useMemo(() => new Set(allMarkets.filter((m) => m.status === 'CLOSED' || m.status === 'SUSPENDED').map((m) => m.coin)), [allMarkets]);

  useEffect(() => {
    let alive = true; setRows(null);
    analytics.getFundingPremium(days).then((d) => { if (alive) setRows(d.markets); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [days]);
  useEffect(() => {
    let alive = true; setSeries(null);
    analytics.getFundingPremiumSeries(sel, days).then((d) => { if (alive) setSeries(d.series); }).catch(() => { if (alive) setSeries([]); });
    return () => { alive = false; };
  }, [sel, days]);

  const list = useMemo(() => (rows ?? []).filter((r) => isIn(r.symbol.replace(/-USD$/, '')) && !inactive.has(r.symbol.replace(/-USD$/, ''))).sort((a, b) => {
    switch (sort) {
      case 'name': return a.symbol.localeCompare(b.symbol);
      case 'avg': return (b.fundingAvg ?? 0) - (a.fundingAvg ?? 0);
      case 'premium': return (b.premiumAbsAvg ?? 0) - (a.premiumAbsAvg ?? 0);
      case 'flips': return b.flips - a.flips;
      default: return (b.fundingNow ?? 0) - (a.fundingNow ?? 0);
    }
  }), [rows, sort, isIn, inactive]);

  const selRow = rows?.find((r) => r.symbol === sel) ?? null;
  const times = (series ?? []).map((p) => p.t);
  const coin = sel.replace(/-USD$/, '');
  const th = (k: SortKey, label: string, cls = '') => (
    <button type="button" onClick={() => setSort(k)} className={cn('text-[11px] transition-colors', cls, sort === k ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>{label}</button>
  );

  return (
    <div className="w-full space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="page-title text-[var(--text-primary)]">Funding</h1>
          <p className="mt-1 text-[14px] text-[var(--text-secondary)]">Hourly funding and the mark-vs-oracle premium for every market. Positive funding: longs pay shorts.</p>
        </div>
        <div className="flex items-center gap-2">
          <AssetClassToggle />
          <div className="toggle-group">{RANGES.map(([d, l]) => <button key={d} type="button" onClick={() => setDays(d)} className={cn('toggle-btn', days === d && 'active')}>{l}</button>)}</div>
        </div>
      </div>

      {/* selected market */}
      <div className="glass-card p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CoinIcon symbol={coin} size={26} />
            <div>
              <div className="text-[15px] font-medium text-[var(--text-primary)]">{sel}</div>
              <div className="text-[11px] text-[var(--text-tertiary)]">Pick a market in the table below</div>
            </div>
          </div>
          {selRow && (
            <div key={sel} className="flex flex-wrap gap-x-6 gap-y-2 text-right animate-[chart-fade_.35s_ease-out]">
              <Kv k="Funding now (APR)" v={pct(apr(selRow.fundingNow))} c={tone(selRow.fundingNow)} />
              <Kv k={`${days}D average (APR)`} v={pct(apr(selRow.fundingAvg))} c={tone(selRow.fundingAvg)} />
              <Kv k="Hours longs paid" v={selRow.positiveShare === null ? '—' : `${Math.round(selRow.positiveShare * 100)}%`} />
              <Kv k="Sign flips" v={String(selRow.flips)} />
              <Kv k="Premium now" v={bp(selRow.premiumNow)} c={tone(selRow.premiumNow)} />
            </div>
          )}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-[12px] text-[var(--text-secondary)]">Funding, annualised (hourly)</div>
            {series === null ? <div className="h-[220px] animate-pulse rounded-xl bg-[var(--bg-base)]" /> :
              <SeriesChart height={220} zeroLine times={times} animKey={`${sel}-${days}`} format={(v) => `${v.toFixed(1)}%`}
                series={[{ key: 'f', label: 'Funding APR', color: 'var(--accent)', values: (series ?? []).map((p) => apr(p.funding)) }]} />}
          </div>
          <div>
            <div className="mb-1 text-[12px] text-[var(--text-secondary)]">Mark vs oracle premium (hourly average)</div>
            {series === null ? <div className="h-[220px] animate-pulse rounded-xl bg-[var(--bg-base)]" /> :
              <SeriesChart height={220} zeroLine times={times} animKey={`${sel}-${days}`} format={(v) => `${v.toFixed(2)} bp`}
                series={[{ key: 'p', label: 'Premium', color: 'var(--text-primary)', values: (series ?? []).map((p) => p.premium) }]} />}
          </div>
        </div>
      </div>

      {/* every market */}
      <div className="glass-card overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] gap-3 border-b border-[var(--border-color)] px-4 py-2.5 md:grid-cols-[minmax(0,1.3fr)_repeat(6,minmax(0,1fr))]">
          {th('name', 'Market', 'text-left')}
          {th('now', 'Now (APR)', 'text-right')}
          {th('avg', `${days}D avg (APR)`, 'text-right')}
          <span className="hidden text-right text-[11px] text-[var(--text-tertiary)] md:block">Longs paid</span>
          {th('flips', 'Flips', 'text-right hidden md:block')}
          {th('premium', 'Avg |premium|', 'text-right')}
          <span className="text-right text-[11px] text-[var(--text-tertiary)]">Premium now</span>
        </div>
        {rows === null && <div className="h-[300px] animate-pulse" />}
        {rows !== null && list.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-[var(--text-tertiary)]">No funding data in this window yet.</p>}
        {list.map((r, i) => {
          const c = r.symbol.replace(/-USD$/, '');
          return (
            <button key={r.symbol} type="button" onClick={() => setSel(r.symbol)} style={{ '--row-index': i } as React.CSSProperties}
              className={cn('animate-row-enter grid w-full grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))] items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-left text-[13px] tabular-nums transition-colors last:border-b-0 hover:bg-[var(--bg-base)] md:grid-cols-[minmax(0,1.3fr)_repeat(6,minmax(0,1fr))]',
                sel === r.symbol && 'bg-[var(--bg-base)]')}>
              <span className="flex min-w-0 items-center gap-2"><CoinIcon symbol={c} size={18} /><span className="truncate font-medium text-[var(--text-primary)]">{c}</span></span>
              <span className="text-right" style={{ color: tone(r.fundingNow) }}>{pct(apr(r.fundingNow))}</span>
              <span className="text-right" style={{ color: tone(r.fundingAvg) }}>{pct(apr(r.fundingAvg))}</span>
              <span className="hidden text-right text-[var(--text-secondary)] md:block">{r.positiveShare === null ? '—' : `${Math.round(r.positiveShare * 100)}%`}</span>
              <span className="hidden text-right text-[var(--text-secondary)] md:block">{r.flips}</span>
              <span className="text-right text-[var(--text-secondary)]">{r.premiumAbsAvg === null ? '—' : `${r.premiumAbsAvg.toFixed(2)} bp`}</span>
              <span className="text-right" style={{ color: tone(r.premiumNow) }}>{bp(r.premiumNow)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Kv({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--text-tertiary)]">{k}</div>
      <div className="text-[16px] font-medium tabular-nums" style={{ color: c ?? 'var(--text-primary)' }}>{v}</div>
    </div>
  );
}
