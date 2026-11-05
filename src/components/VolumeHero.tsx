'use client';

// VolumeHero — the landing page's lead card (ASXN/Hyperliquid style): a big
// volume headline (24h ↔ all-time) over a per-coin stacked volume-history chart
// with a continuous cumulative line, a bar/line/area switcher, and timeframe
// pills. Fixed default/Other stacks (no coin selector). The cumulative line
// comes straight from the backend, which anchors it to all-time − window volume,
// so it always starts at (total volume − this window's volume) and ends at the
// true all-time total.
//
// Asset classes: the site-wide All / Crypto / Stocks filter applies here too.
// Narrowed, the stacks become that class's defaults (SNDK/MU/NVDA for stocks),
// the 24h headline is the sum of the class's per-market 24h volume from the
// live tickers (BULK's own rolling 24h, not since-midnight), the all-time
// headline is the class's share of the daily history, and the cumulative line
// is re-anchored the same way the backend does it (all-time − window).

import { useEffect, useMemo, useState } from 'react';
import { Area, Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { BarChart3, Activity, TrendingUp } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { AssetClassToggle } from './AssetClassToggle';
import { analytics, cn, formatCompact, type ChartData } from '@/lib/api';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAssetClass } from '@/hooks/useAssetClass';
import type { BulkTicker } from '@/hooks/useTickers';
import { getCoinColor, OTHER_KEY, adaptLegacyRow, sumCoins } from '@/lib/coins';

const CUMULATIVE_COLOR = 'var(--accent)';

const ALL_HOURS = 8760 * 3;
const RANGES: { label: string; hours: number }[] = [
  { label: '1D', hours: 24 },
  { label: '1W', hours: 168 },
  { label: '1M', hours: 720 },
  { label: '3M', hours: 2160 },
  { label: 'ALL', hours: ALL_HOURS },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';
const fmtUsd = (n: number): string => `$${formatCompact(n)}`;

const coinsFromRow = (row: ChartData): Record<string, number> =>
  (row.coins && typeof row.coins === 'object') ? (row.coins as Record<string, number>) : adaptLegacyRow(row as Record<string, unknown>).coins;

export function VolumeHero({ tickers = [] }: { tickers?: BulkTicker[] }) {
  const { network } = useCurrentNetwork();
  const isMobile = useIsMobile();
  const { narrowed, defaults, filterDict, isIn } = useAssetClass();
  const [hours, setHours] = useState(24);
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area'>('bar');
  const [headlineMode, setHeadlineMode] = useState<'24h' | 'all'>('24h');
  const [rows, setRows] = useState<ChartData[]>([]);
  const [allRows, setAllRows] = useState<ChartData[]>([]);
  const [vol24h, setVol24h] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Fixed stacks, bottom→top: the class defaults reversed (so the first
  // default — BTC, or SNDK — ends up on top) with Other above it.
  const stack = useMemo(() => [...[...defaults].reverse(), OTHER_KEY], [defaults]);

  // Headline 24h number (true rolling window from exchange-stats).
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`${API_URL}/api/analytics/exchange-stats${network ? `?net=${network}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.volume24h != null) setVol24h(d.volume24h); })
      .catch(() => {});
    load();
    const id = window.setInterval(load, 15000); // 15s — keep the headline volume fresh
    return () => { cancelled = true; window.clearInterval(id); };
  }, [network]);

  // Windowed per-coin history + a backend-computed continuous Cumulative.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    analytics.getVolumeFromBulkAPI(hours)
      .then((d) => { if (!cancelled) setRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hours, network]);

  // Narrowed to a class we need the FULL daily history too: the backend's
  // Cumulative and all-time total are exchange-wide, so the class versions are
  // rebuilt here from the per-coin dicts (all-time − window, like the backend).
  useEffect(() => {
    if (!narrowed) { setAllRows([]); return; }
    let cancelled = false;
    analytics.getVolumeFromBulkAPI(ALL_HOURS)
      .then((d) => { if (!cancelled) setAllRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setAllRows([]); });
    return () => { cancelled = true; };
  }, [narrowed, network]);

  // Class 24h headline: sum of the class's per-market rolling-24h quote volume.
  const classVol24h = useMemo(() => {
    if (!narrowed) return null;
    return tickers.filter((t) => isIn(t.symbol)).reduce((s, t) => s + (t.quoteVolume || 0), 0);
  }, [tickers, narrowed, isIn]);

  // Shape rows to fixed default/Other stacks. Exchange-wide: keep the backend's
  // total + Cumulative verbatim. Narrowed: everything from the filtered dicts.
  const { data, allTimeTotal } = useMemo(() => {
    const classTotal = (r: ChartData) => sumCoins(filterDict(coinsFromRow(r)));
    const allTotal = narrowed ? allRows.reduce((s, r) => s + classTotal(r), 0) : 0;
    let cumulative = 0;
    if (narrowed) {
      const windowTotal = rows.reduce((s, r) => s + classTotal(r), 0);
      cumulative = Math.max(0, allTotal - windowTotal);
    }
    const shaped = rows.map((r) => {
      const dict = filterDict(coinsFromRow(r));
      const total = narrowed
        ? sumCoins(dict)
        : (typeof (r as any).total === 'number' ? (r as any).total : sumCoins(dict));
      const out: Record<string, number | string> = { timestamp: r.timestamp, total };
      let named = 0;
      for (const c of defaults) { const v = dict[c] || 0; out[c] = v; named += v; }
      out[OTHER_KEY] = Math.max(0, total - named);
      if (narrowed) { cumulative += total; out.Cumulative = cumulative; }
      else out.Cumulative = Number((r as any).Cumulative) || 0;
      return out;
    });
    const last = shaped[shaped.length - 1];
    return {
      data: shaped,
      allTimeTotal: narrowed ? allTotal : (last ? Number(last.Cumulative) : 0),
    };
  }, [rows, allRows, narrowed, defaults, filterDict]);

  const headlineValue = headlineMode === 'all'
    ? allTimeTotal
    : (narrowed ? (classVol24h ?? 0) : (vol24h ?? 0));
  const headlineReady = headlineMode === 'all'
    ? (narrowed ? allRows.length > 0 : data.length > 0)
    : (narrowed ? tickers.length > 0 : vol24h != null);

  const changePct = useMemo(() => {
    if (data.length < 2) return null;
    const prev = Number(data[data.length - 2].total);
    if (!prev) return null;
    return ((Number(data[data.length - 1].total) - prev) / prev) * 100;
  }, [data]);

  const fmtAxis = (ts: string) => {
    const d = new Date(ts);
    return hours <= 24
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const fmtLabel = (ts: string) => {
    const d = new Date(ts);
    return hours <= 24
      ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const axisTick = { fill: 'var(--role-content-subtle)', fontSize: isMobile ? 10 : 11 };

  return (
    <div className="glass-card flex h-full flex-col p-4 sm:p-5">
      {/* Header — label/number on the left, controls top-right. On mobile the
          controls stack vertically (timeframe pills on top, chart-type icons
          below); side by side from sm up. */}
      <div className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-0.5 rounded-md bg-[var(--role-surface-raised)]/50 p-0.5 text-[11px] font-medium">
            {(['24h', 'all'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setHeadlineMode(m)}
                className={cn('rounded px-1.5 py-0.5 transition-colors',
                  headlineMode === m ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}
              >
                {m === '24h' ? '24h Volume' : 'Total Volume'}
              </button>
            ))}
          </div>
          <div className="mt-1 flex items-baseline gap-2.5">
            <span className="text-[34px] font-medium font-sans leading-none tracking-tight tabular-nums text-[var(--role-content)] sm:text-[40px]">
              {!headlineReady ? <span className="text-[var(--role-content-subtle)]">—</span> : <AnimatedNumber value={headlineValue} format={fmtUsd} />}
            </span>
            {headlineMode === '24h' && changePct != null && Number.isFinite(changePct) && (
              <span className={cn('whitespace-nowrap text-[13px] font-semibold tabular-nums', changePct >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>
                {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(1)}%
              </span>
            )}
            {headlineMode === 'all' && <span className="text-[13px] font-medium text-[var(--role-content-subtle)]">all-time</span>}
          </div>
        </div>
        {/* Toolbar. JSX order is class toggle, chart-type, timeframe. On mobile
            we flex-col-reverse so the timeframe pills land ON TOP; from sm up
            it's the normal side-by-side row. */}
        <div className="flex flex-col-reverse items-end gap-1.5 shrink-0 sm:flex-row sm:items-center sm:gap-2">
          <AssetClassToggle />
          <div className="flex items-center gap-0.5 rounded-lg bg-[var(--role-surface-raised)]/60 p-0.5">
            {([
              { key: 'bar', Icon: BarChart3, label: 'Bars' },
              { key: 'line', Icon: Activity, label: 'Line' },
              { key: 'area', Icon: TrendingUp, label: 'Area' },
            ] as const).map(({ key, Icon, label }) => (
              <button
                key={key}
                onClick={() => setChartType(key)}
                title={label}
                aria-pressed={chartType === key}
                className={cn('flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                  chartType === key ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-lg bg-[var(--role-surface-raised)]/60 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setHours(r.hours)}
                className={cn('rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                  hours === r.hours ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="mt-3 min-h-0 flex-1">
        {loading && data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--role-content-subtle)]">Loading…</div>
        ) : data.length < 1 ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-[var(--role-content-subtle)]">Volume history builds as data accumulates.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
              <defs>
                <linearGradient id="volHeroArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--role-line-subtle)" strokeOpacity={0.5} />
              <XAxis dataKey="timestamp" tickFormatter={fmtAxis} tick={axisTick} axisLine={false} tickLine={false} minTickGap={isMobile ? 32 : 48} />
              <YAxis yAxisId="left" tick={axisTick} axisLine={false} tickLine={false} width={isMobile ? 40 : 54} tickFormatter={(v) => `$${formatCompact(Number(v))}`} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} axisLine={false} tickLine={false} width={isMobile ? 40 : 54} tickFormatter={(v) => `$${formatCompact(Number(v))}`} />
              <Tooltip
                cursor={{ fill: 'var(--role-surface-raised)', opacity: 0.4 }}
                contentStyle={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}
                labelFormatter={(t) => fmtLabel(t as string)}
                formatter={(v: number, n: string) => [`$${formatCompact(Number(v))}`, n === OTHER_KEY ? 'Other' : n]}
              />
              {chartType === 'bar' && stack.map((coin, i, arr) => (
                <Bar key={coin} yAxisId="left" dataKey={coin} name={coin === OTHER_KEY ? 'Other' : coin} stackId="v" fill={getCoinColor(coin)} maxBarSize={48}
                  radius={i === arr.length - 1 ? [2, 2, 0, 0] : undefined} isAnimationActive animationDuration={600} animationEasing="ease-out" />
              ))}
              {chartType === 'line' && (
                <Line yAxisId="left" type="monotone" dataKey="total" name="Volume" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive animationDuration={600} animationEasing="ease-out" />
              )}
              {chartType === 'area' && (
                <Area yAxisId="left" type="monotone" dataKey="total" name="Volume" stroke="var(--accent)" strokeWidth={2} fill="url(#volHeroArea)" dot={false} isAnimationActive animationDuration={600} animationEasing="ease-out" />
              )}
              <Line yAxisId="right" type="monotone" dataKey="Cumulative" name="Cumulative" stroke={CUMULATIVE_COLOR} strokeWidth={2} dot={false} isAnimationActive animationDuration={600} animationEasing="ease-out" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
