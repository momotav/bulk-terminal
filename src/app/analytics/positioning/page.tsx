'use client';

import { LazySection } from '@/components/LazySection';
import { useEffect, useMemo, useState } from 'react';
import { analytics, cn, formatCompact, type PositioningRow } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';
import { SeriesChart, Legend } from '@/components/charts/SeriesChart';
import { useAssetClass } from '@/hooks/useAssetClass';
import { AssetClassToggle } from '@/components/AssetClassToggle';
import { PositionChanges } from '@/components/positioning/PositionChanges';
import { Cohorts } from '@/components/positioning/Cohorts';

const RANGES = [[1, '1D'], [7, '7D'], [30, '30D']] as const;
const px = (n: number | null) => (n === null ? '—' : n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(4));
const usd = (n: number) => `$${formatCompact(n)}`;

/**
 * Where BULK's most active traders stand: long vs short exposure per market, how
 * it moved in 24h, their average entries and how concentrated it is. From the live
 * account stream (top 300 traders by volume), snapshotted every 5 minutes.
 */
export default function PositioningPage() {
  const [rows, setRows] = useState<PositioningRow[] | null>(null);
  const [sel, setSel] = useState('BTC-USD');
  const [days, setDays] = useState<number>(7);
  const [hist, setHist] = useState<{ t: number; long: number; short: number; longEntry: number | null; shortEntry: number | null }[] | null>(null);
  const { isIn } = useAssetClass();

  useEffect(() => {
    let alive = true;
    const load = () => analytics.getPositioning().then((d) => { if (alive) setRows(d.markets); }).catch(() => { if (alive) setRows((r) => r ?? []); });
    load(); const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  useEffect(() => {
    let alive = true; setHist(null);
    analytics.getPositioningHistory(sel, days).then((d) => { if (alive) setHist(d.series); }).catch(() => { if (alive) setHist([]); });
    return () => { alive = false; };
  }, [sel, days]);

  const list = useMemo(() => (rows ?? []).filter((r) => isIn(r.symbol.replace(/-USD$/, ''))), [rows, isIn]);
  const tot = list.reduce((a, r) => ({ l: a.l + r.long, s: a.s + r.short }), { l: 0, s: 0 });
  const selRow = rows?.find((r) => r.symbol === sel) ?? null;
  const coin = sel.replace(/-USD$/, '');
  const times = (hist ?? []).map((p) => p.t);
  const notionalSeries = [
    { key: 'l', label: 'Long', color: 'var(--pos)', values: (hist ?? []).map((p) => p.long) },
    { key: 's', label: 'Short', color: 'var(--neg)', values: (hist ?? []).map((p) => p.short) },
  ];
  const entrySeries = [
    { key: 'le', label: 'Avg long entry', color: 'var(--pos)', values: (hist ?? []).map((p) => p.longEntry) },
    { key: 'se', label: 'Avg short entry', color: 'var(--neg)', values: (hist ?? []).map((p) => p.shortEntry) },
  ];

  return (
    <div className="w-full space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="page-title text-[var(--text-primary)]">Positioning</h1>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
          Where BULK’s {rows?.[0]?.wallets ?? 300} most active traders stand right now: long vs short per market, their average entries and how concentrated it is.
        </p>
      </div>
      <AssetClassToggle />
      </div>

      {list.length > 0 && (
        <div className="tint-split rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-5 py-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[12px] text-[var(--text-tertiary)]">Long exposure</div>
              <div className="text-[24px] font-medium leading-tight tabular-nums" style={{ color: 'var(--pos)' }}>{usd(tot.l)}</div>
            </div>
            <div className="hidden text-center sm:block">
              <div className="text-[12px] text-[var(--text-tertiary)]">Net · long share</div>
              <div className="text-[18px] font-medium tabular-nums" style={{ color: tot.l >= tot.s ? 'var(--pos)' : 'var(--neg)' }}>
                {`${tot.l - tot.s >= 0 ? '+' : '−'}${usd(Math.abs(tot.l - tot.s))}`}
                <span className="ml-2 text-[var(--text-secondary)]">{tot.l + tot.s > 0 ? `${Math.round((tot.l / (tot.l + tot.s)) * 100)}%` : '—'}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[12px] text-[var(--text-tertiary)]">Short exposure</div>
              <div className="text-[24px] font-medium leading-tight tabular-nums" style={{ color: 'var(--neg)' }}>{usd(tot.s)}</div>
            </div>
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
            <div className="grad-pos-l transition-[width] duration-700 ease-out" style={{ width: `${tot.l + tot.s > 0 ? (tot.l / (tot.l + tot.s)) * 100 : 50}%` }} />
            <div className="w-0.5" />
            <div className="grad-neg-r flex-1" />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-[var(--text-tertiary)]">
            <span>{list.reduce((a, r) => a + r.longN, 0)} long positions</span>
            <span>across {list.length} markets</span>
            <span>{list.reduce((a, r) => a + r.shortN, 0)} short positions</span>
          </div>
        </div>
      )}

      <PositionChanges isIn={isIn} />
      <LazySection minHeight={260}><Cohorts isIn={isIn} /></LazySection>

      {/* selected market history */}
      <div className="glass-card p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CoinIcon symbol={coin} size={26} />
            <div>
              <div className="text-[15px] font-medium text-[var(--text-primary)]">{sel}</div>
              <div key={sel} className="text-[11px] text-[var(--text-tertiary)] animate-[chart-fade_.35s_ease-out]">{selRow ? `${selRow.longN} long · ${selRow.shortN} short · top 5 hold ${selRow.top5Share === null ? '—' : `${Math.round(selRow.top5Share * 100)}%`}` : 'Pick a market below'}</div>
            </div>
          </div>
          <div className="toggle-group">{RANGES.map(([d, l]) => <button key={d} type="button" onClick={() => setDays(d)} className={cn('toggle-btn', days === d && 'active')}>{l}</button>)}</div>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-[12px] text-[var(--text-secondary)]">Long vs short exposure</div>
            {hist === null ? <div className="h-[220px] animate-pulse rounded-xl bg-[var(--bg-base)]" /> :
              <SeriesChart height={220} times={times} animKey={`${sel}-${days}`} series={notionalSeries} format={(v) => usd(v)} emptyText="Collecting. History builds from the first snapshots." />}
            <div className="mt-2"><Legend series={notionalSeries} /></div>
          </div>
          <div>
            <div className="mb-1 text-[12px] text-[var(--text-secondary)]">Average entry price</div>
            {hist === null ? <div className="h-[220px] animate-pulse rounded-xl bg-[var(--bg-base)]" /> :
              <SeriesChart height={220} times={times} animKey={`${sel}-${days}`} series={entrySeries} format={(v) => px(v)} emptyText="Collecting. History builds from the first snapshots." />}
            <div className="mt-2"><Legend series={entrySeries} /></div>
          </div>
        </div>
      </div>

      {/* every market */}
      <div className="glass-card overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_90px] gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)] md:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_80px_100px_110px_110px_80px]">
          <span>Market</span><span>Long / short</span><span className="text-right">24h</span>
          <span className="hidden text-right md:block">Exposure</span><span className="hidden text-right md:block">Avg long entry</span><span className="hidden text-right md:block">Avg short entry</span><span className="hidden text-right md:block">Top 5</span>
        </div>
        {rows === null && <div className="h-[300px] animate-pulse" />}
        {rows !== null && list.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-[var(--text-tertiary)]">Collecting the first snapshot. Back in a few minutes.</p>}
        {list.map((r, i) => {
          const c = r.symbol.replace(/-USD$/, '');
          const lr = r.longRatio ?? 0.5;
          const d = r.longRatio !== null && r.longRatio24hAgo !== null ? (r.longRatio - r.longRatio24hAgo) * 100 : null;
          return (
            <button key={r.symbol} type="button" onClick={() => setSel(r.symbol)} style={{ '--row-index': i } as React.CSSProperties}
              className={cn('animate-row-enter grid w-full grid-cols-[minmax(0,1fr)_minmax(0,2fr)_90px] items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-left text-[13px] tabular-nums transition-colors last:border-b-0 hover:bg-[var(--bg-base)] md:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_80px_100px_110px_110px_80px]',
                sel === r.symbol && 'bg-[var(--bg-base)]')}>
              <span className="flex min-w-0 items-center gap-2"><CoinIcon symbol={c} size={18} /><span className="truncate font-medium text-[var(--text-primary)]">{c}</span></span>
              <span className="flex items-center gap-2">
                <span className="w-9 text-right text-[12px]" style={{ color: 'var(--pos)' }}>{Math.round(lr * 100)}%</span>
                <span className="flex h-2 flex-1 overflow-hidden rounded-full">
                  <span className="grad-pos-l transition-[width] duration-700 ease-out" style={{ width: `${lr * 100}%` }} />
                  <span className="w-px" />
                  <span className="grad-neg-r flex-1" />
                </span>
                <span className="w-9 text-[12px]" style={{ color: 'var(--neg)' }}>{100 - Math.round(lr * 100)}%</span>
              </span>
              <span className="text-right text-[12px]" style={{ color: d === null || Math.abs(d) < 0.5 ? 'var(--text-tertiary)' : d > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                {d === null ? '—' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pp`}
              </span>
              <span className="hidden text-right text-[var(--text-primary)] md:block">{usd(r.long + r.short)}</span>
              <span className="hidden text-right text-[var(--text-secondary)] md:block">{px(r.longEntry)}</span>
              <span className="hidden text-right text-[var(--text-secondary)] md:block">{px(r.shortEntry)}</span>
              <span className="hidden text-right text-[var(--text-secondary)] md:block">{r.top5Share === null ? '—' : `${Math.round(r.top5Share * 100)}%`}</span>
            </button>
          );
        })}
      </div>
      <p className="px-1 text-[11px] text-[var(--text-tertiary)]">Top traders = the 300 most active wallets by volume, followed live through BULK’s account stream. 24h = change in long share, in percentage points.</p>
    </div>
  );
}

