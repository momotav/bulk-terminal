'use client';

// VolumeHero — the landing page's lead card: the exchange's 24h volume as a big
// headline over a full history bar chart, with timeframe pills. The
// "analytics product" hero (ASXN/Hyperliquid style): the first thing you see is
// the volume trend, not a strip of small stats.

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnimatedNumber } from './AnimatedNumber';
import { analytics, cn, formatCompact, type ChartData } from '@/lib/api';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { useIsMobile } from '@/hooks/useIsMobile';

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

export function VolumeHero() {
  const { network } = useCurrentNetwork();
  const isMobile = useIsMobile();
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState<ChartData[]>([]);
  const [vol24h, setVol24h] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Headline 24h number (true rolling window from exchange-stats), refreshed
  // periodically so it ticks like the rest of the dashboard.
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

  // History bars for the selected timeframe.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Same source as the Analytics volume chart: hourly buckets for ≤24h, daily
    // beyond — so 1D is rich and consistent with what /analytics shows.
    analytics.getVolumeFromBulkAPI(hours)
      .then((d) => { if (!cancelled) setRows(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hours, network]);

  const bars = useMemo(
    () => rows.map((r) => ({ t: r.timestamp, total: typeof r.total === 'number' ? r.total : 0 })).filter((b) => b.total > 0),
    [rows],
  );

  // Day-over-day change from the last two full daily buckets.
  const changePct = useMemo(() => {
    if (bars.length < 2) return null;
    const prev = bars[bars.length - 2].total;
    if (!prev) return null;
    return ((bars[bars.length - 1].total - prev) / prev) * 100;
  }, [bars]);

  // Hourly buckets (1D) → show the time; daily buckets → show the date.
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

  return (
    <div className="glass-card flex h-full flex-col p-4 sm:p-5">
      {/* Header: headline number + change, timeframe pills on the right. */}
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
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                hours === r.hours ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      <div className="mt-3 min-h-0 flex-1">
        {loading && bars.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--role-content-subtle)]">Loading…</div>
        ) : bars.length < 1 ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-[var(--role-content-subtle)]">Volume history builds as data accumulates.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="18%">
              <defs>
                <linearGradient id="volHeroGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tickFormatter={fmtAxis} tick={{ fill: 'var(--role-content-subtle)', fontSize: isMobile ? 10 : 11 }} axisLine={false} tickLine={false} minTickGap={isMobile ? 32 : 48} />
              <YAxis tick={{ fill: 'var(--role-content-subtle)', fontSize: isMobile ? 10 : 11 }} axisLine={false} tickLine={false} width={isMobile ? 38 : 52} tickFormatter={(v) => `$${formatCompact(Number(v))}`} />
              <Tooltip
                cursor={{ fill: 'var(--role-surface-raised)', opacity: 0.4 }}
                contentStyle={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}
                labelFormatter={(t) => fmtLabel(t as string)}
                formatter={(v: number) => [`$${formatCompact(Number(v))}`, 'Volume']}
              />
              <Bar dataKey="total" fill="url(#volHeroGrad)" radius={[2, 2, 0, 0]} maxBarSize={48} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
