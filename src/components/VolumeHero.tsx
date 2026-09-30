'use client';

// VolumeHero — the landing page's lead card: the exchange's 24h volume as a big
// headline over a per-coin stacked volume-history chart with a continuous
// cumulative line, mirroring the Analytics "Total Volume" chart. Timeframe
// pills + a coin selector so you can add/remove markets; the cumulative line
// rides a right axis and carries over from all-time (never resets to 0).

import { useEffect, useMemo, useState } from 'react';
import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { AnimatedNumber } from './AnimatedNumber';
import { CoinSelector } from './CoinSelector';
import { analytics, cn, formatCompact, type ChartData } from '@/lib/api';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { useIsMobile } from '@/hooks/useIsMobile';
import { DEFAULT_COINS, DEFAULT_ENABLED, OTHER_KEY, getCoinColor, bucketWithOther, adaptLegacyRow } from '@/lib/coins';

const CUMULATIVE_COLOR = 'var(--accent)';

// 1D is hourly (rich ~24 bars); longer ranges are daily buckets that fill in as
// history accumulates. Same data source as the Analytics volume chart.
const RANGES: { label: string; hours: number }[] = [
  { label: '1D', hours: 24 },
  { label: '1W', hours: 168 },
  { label: '1M', hours: 720 },
  { label: '3M', hours: 2160 },
  { label: 'ALL', hours: 8760 * 3 },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';
const fmtUsd = (n: number): string => `$${formatCompact(n)}`;

// Stacking order (bottom→top): extra coins, then SOL/ETH/BTC, then Other on top.
function orderedSeriesFor(enabled: readonly string[]): string[] {
  const set = new Set(enabled);
  const extras = enabled.filter((c) => c !== OTHER_KEY && !(DEFAULT_COINS as readonly string[]).includes(c));
  const defaults = (DEFAULT_COINS as readonly string[]).filter((c) => set.has(c));
  const ordered = [...extras, ...defaults.slice().reverse()];
  if (set.has(OTHER_KEY)) ordered.push(OTHER_KEY);
  return ordered;
}

const coinsFromRow = (row: ChartData): Record<string, number> =>
  (row.coins && typeof row.coins === 'object') ? (row.coins as Record<string, number>) : adaptLegacyRow(row as Record<string, unknown>).coins;

export function VolumeHero() {
  const { network } = useCurrentNetwork();
  const isMobile = useIsMobile();
  const [hours, setHours] = useState(24);
  const [coins, setCoins] = useState<string[]>([...DEFAULT_ENABLED]);
  const [rows, setRows] = useState<ChartData[]>([]);
  const [allTime, setAllTime] = useState<ChartData[]>([]);
  const [vol24h, setVol24h] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Headline 24h number (true rolling window from exchange-stats).
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`${API_URL}/api/analytics/exchange-stats${network ? `?net=${network}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.volume24h != null) setVol24h(d.volume24h); })
      .catch(() => {});
    load();
    const id = window.setInterval(load, 30000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [network]);

  // Windowed history for the bars (hourly ≤24h, daily beyond — same as Analytics).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    analytics.getVolumeFromBulkAPI(hours)
      .then((d) => { if (!cancelled) setRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hours, network]);

  // All-time daily volume — the cumulative line's baseline, so it carries over
  // from prior history instead of restarting at 0 for each timeframe.
  useEffect(() => {
    let cancelled = false;
    analytics.getVolumeChart(8760 * 3)
      .then((d) => { if (!cancelled) setAllTime(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setAllTime([]); });
    return () => { cancelled = true; };
  }, [network]);

  // Bucket to enabled coins + Other, then attach a continuous Cumulative anchored
  // to (all-time total − visible-window total) so it always ends at the true
  // all-time value. Ported from the Analytics page.
  const data = useMemo(() => {
    if (rows.length === 0) return [] as any[];
    const enabledSet = new Set(coins);
    const showOther = enabledSet.has(OTHER_KEY);
    const sumSelected = (dict: Record<string, number>): number => {
      let s = 0;
      for (const [coin, v] of Object.entries(dict)) {
        if (typeof v !== 'number' || !isFinite(v)) continue;
        if (enabledSet.has(coin) || showOther) s += v;
      }
      return s;
    };
    const normalized = rows.map((row) => ({ ...row, coins: coinsFromRow(row) })) as (ChartData & { coins: Record<string, number> })[];
    const bucketed = bucketWithOther(normalized as any, coins);
    const rowSumOf = (row: Record<string, unknown>) => {
      let s = 0;
      for (const [k, v] of Object.entries(row)) {
        if (k === 'timestamp' || k === 'total' || k === 'Cumulative') continue;
        if (typeof v === 'number') s += v;
      }
      return s;
    };
    const allTimeTotal = allTime.reduce((s, p) => s + sumSelected(coinsFromRow(p)), 0);
    const windowTotal = bucketed.reduce((s, row) => s + rowSumOf(row as any), 0);
    let cumulative = allTime.length > 0 ? Math.max(0, allTimeTotal - windowTotal) : 0;
    return bucketed.map((row) => {
      const rowSum = rowSumOf(row as any);
      cumulative += rowSum;
      return { ...row, total: rowSum, Cumulative: cumulative };
    });
  }, [rows, allTime, coins]);

  const series = useMemo(() => orderedSeriesFor(coins), [coins]);

  const changePct = useMemo(() => {
    if (data.length < 2) return null;
    const prev = data[data.length - 2].total;
    if (!prev) return null;
    return ((data[data.length - 1].total - prev) / prev) * 100;
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
      {/* Header: headline number + change, timeframe pills. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-[var(--role-content-subtle)]">24h Volume</div>
          <div className="mt-1 flex items-baseline gap-2.5">
            <span className="text-[34px] font-medium font-sans leading-none tracking-tight tabular-nums text-[var(--role-content)] sm:text-[40px]">
              {vol24h == null ? <span className="text-[var(--role-content-subtle)]">—</span> : <AnimatedNumber value={vol24h} format={fmtUsd} />}
            </span>
            {changePct != null && Number.isFinite(changePct) && (
              <span className={cn('text-[13px] font-semibold tabular-nums', changePct >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>
                {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--role-surface-raised)]/60 p-0.5">
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

      {/* Coin selector — add / remove markets, plus a Cumulative legend pill. */}
      <div className="mt-3">
        <CoinSelector
          enabled={coins}
          onChange={setCoins}
          extraPills={[{ key: 'cumulative', label: 'Cumulative', color: CUMULATIVE_COLOR, active: true, onClick: () => {} }]}
        />
      </div>

      {/* Chart: stacked coin bars (left axis) + cumulative line (right axis). */}
      <div className="mt-2 min-h-0 flex-1">
        {loading && data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--role-content-subtle)]">Loading…</div>
        ) : data.length < 1 ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-[var(--role-content-subtle)]">Volume history builds as data accumulates.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
              <CartesianGrid vertical={false} stroke="var(--role-line-subtle)" strokeOpacity={0.5} />
              <XAxis dataKey="timestamp" tickFormatter={fmtAxis} tick={axisTick} axisLine={false} tickLine={false} minTickGap={isMobile ? 32 : 48} />
              <YAxis yAxisId="left" tick={axisTick} axisLine={false} tickLine={false} width={isMobile ? 40 : 54} tickFormatter={(v) => `$${formatCompact(Number(v))}`} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} axisLine={false} tickLine={false} width={isMobile ? 40 : 54} tickFormatter={(v) => `$${formatCompact(Number(v))}`} />
              <Tooltip
                cursor={{ fill: 'var(--role-surface-raised)', opacity: 0.4 }}
                contentStyle={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}
                labelFormatter={(t) => fmtLabel(t as string)}
                formatter={(v: number, n: string) => [`$${formatCompact(Number(v))}`, n === 'Cumulative' ? 'Cumulative' : n]}
              />
              {series.map((coin, i, arr) => (
                <Bar key={coin} yAxisId="left" dataKey={coin} name={coin} stackId="v" fill={getCoinColor(coin)} maxBarSize={48}
                  radius={i === arr.length - 1 ? [2, 2, 0, 0] : undefined} isAnimationActive={false} />
              ))}
              <Line yAxisId="right" type="monotone" dataKey="Cumulative" name="Cumulative" stroke={CUMULATIVE_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
