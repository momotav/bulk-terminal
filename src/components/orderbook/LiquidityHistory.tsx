'use client';

import { useEffect, useMemo, useState } from 'react';
import { analytics, cn, formatCompact } from '@/lib/api';
import { SeriesChart, Legend } from '@/components/charts/SeriesChart';
import { InfoTip } from '@/components/InfoTip';

type Data = Awaited<ReturnType<typeof analytics.getLiquidityHistory>>;
const RANGES = [[1, '1D'], [7, '7D'], [30, '30D']] as const;
const VIEWS = [['cost', 'Cost to trade'], ['spread', 'Spread'], ['depth', 'Depth']] as const;
const bp = (v: number) => (v < 0.01 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(1));

/**
 * How a market's liquidity changes over time: the round-trip cost of trading at
 * size, the spread, the depth near the price, and which hours of the day are
 * cheapest. Recorded every 5 minutes from the live book.
 */
export function LiquidityHistory({ coin }: { coin: string }) {
  const sym = coin.replace(/-USD$/, '');
  const [days, setDays] = useState<number>(7);
  const [view, setView] = useState<(typeof VIEWS)[number][0]>('cost');
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let alive = true; setData(null);
    const load = () => analytics.getLiquidityHistory(coin, days).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData({ symbol: coin, days, series: [], byHour: [] }); });
    load(); const t = window.setInterval(load, 5 * 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [coin, days]);

  const s = data?.series ?? [];
  const times = s.map((p) => p.t);
  const series = useMemo(() => {
    if (view === 'cost') return [
      { key: 'c10k', label: '$10K', color: 'var(--text-tertiary)', values: s.map((p) => p.c10k) },
      { key: 'c100k', label: '$100K', color: 'var(--accent)', values: s.map((p) => p.c100k) },
      { key: 'c1m', label: '$1M', color: 'var(--text-primary)', values: s.map((p) => p.c1m), dashed: true },
    ];
    if (view === 'spread') return [{ key: 'spread', label: 'Spread', color: 'var(--accent)', values: s.map((p) => p.spread) }];
    return [
      { key: 'bid', label: 'Bids ±2%', color: 'var(--pos)', values: s.map((p) => p.bidDepth) },
      { key: 'ask', label: 'Asks ±2%', color: 'var(--neg)', values: s.map((p) => p.askDepth) },
    ];
  }, [s, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const hours = data?.byHour ?? [];
  const hmax = Math.max(0.0001, ...hours.map((h) => h.c100k ?? 0));
  const first = s[0]?.t;

  return (
    <div className="glass-card p-4 md:p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="panel-title t-h2 flex items-center gap-2">
            Liquidity history
            <InfoTip label="About liquidity history">
              How {sym}’s book changes over time, recorded every 5 minutes{first ? ` since ${new Date(first).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.
              Cost to trade is a round trip, buying and selling the size at once, against the mid price.
            </InfoTip>
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="toggle-group">{VIEWS.map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={cn('toggle-btn', view === k && 'active')}>{l}</button>)}</div>
          <div className="toggle-group">{RANGES.map(([d, l]) => <button key={d} type="button" onClick={() => setDays(d)} className={cn('toggle-btn', days === d && 'active')}>{l}</button>)}</div>
        </div>
      </div>

      {data === null ? <div className="h-[240px] animate-pulse rounded-xl bg-[var(--bg-base)]" /> : (
        <>
          <SeriesChart times={times} series={series} animKey={`${coin}-${days}-${view}`} format={view === 'depth' ? (v) => `$${formatCompact(v)}` : (v) => `${bp(v)} bp`}
            emptyText="Collecting. The first points appear within minutes and the history builds from here." />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Legend series={series} />
          </div>
        </>
      )}

      {hours.length >= 6 && (
        <div className="mt-6 border-t border-[var(--border-color)] pt-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">Cost of a $100K round trip by hour (UTC)</span>
          </div>
          <div className="grid h-[90px] grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-[3px]">
            {Array.from({ length: 24 }, (_, h) => {
              const r = hours.find((x) => x.hour === h);
              const v = r?.c100k ?? null;
              return (
                <div key={h} className="group relative flex h-full flex-col justify-end" title={v === null ? `${h}:00 — no data` : `${String(h).padStart(2, '0')}:00 UTC · ${bp(v)} bp`}>
                  <div className="w-full rounded-t-[3px] transition-opacity group-hover:opacity-100" style={{ height: `${v === null ? 2 : Math.max(4, (v / hmax) * 100)}%`, background: 'var(--accent)', opacity: v === null ? 0.15 : 0.75 }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-[var(--text-tertiary)]"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </div>
      )}
    </div>
  );
}
