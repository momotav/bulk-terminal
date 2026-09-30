'use client';

// TodayPanel — the right column of the dashboard "Today" section, laid out like
// ASXN: two small metric cards on top (Open Interest, Active Traders), each a
// big number + change over a mini area chart, and a wider Revenue card below
// (big cumulative number + annualized / daily-avg sub-stats + a bar chart with
// timeframe pills). Sits beside the Total Volume hero.

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnimatedNumber } from './AnimatedNumber';
import { analytics, cn, formatCompact } from '@/lib/api';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';

type Spark = { series: number[]; changePct: number | null; low: number | null; high: number | null };
type Sparklines = Record<'volume24h' | 'openInterest' | 'activeTraders' | 'liquidations24h', Spark>;

const fmtUsd = (n: number) => `$${formatCompact(n)}`;
const fmtCount = (n: number) => Math.round(n).toLocaleString();

export function TodayPanel() {
  const { network } = useCurrentNetwork();
  const [stats, setStats] = useState<{ openInterest: number; activeTraders: number } | null>(null);
  const [sparks, setSparks] = useState<Sparklines | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_URL}${withNetwork('/api/analytics/exchange-stats')}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setStats({ openInterest: d.openInterest ?? 0, activeTraders: d.activeTraders ?? 0 }); })
        .catch(() => {});
      fetch(`${API_URL}${withNetwork('/api/analytics/dashboard-sparklines')}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setSparks(d); })
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, 30000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [network]);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Two metric cards — a fixed height, a little under half the hero, so the
          revenue card fills the rest and nothing grows unbounded. */}
      <div className="grid grid-cols-2 gap-3 flex-none h-[150px] lg:h-[190px]">
        <MetricMiniCard
          label="Open Interest"
          value={stats?.openInterest ?? null}
          format={fmtUsd}
          spark={sparks?.openInterest}
          color="var(--role-signal-info)"
        />
        <MetricMiniCard
          label="Active Traders"
          value={stats?.activeTraders ?? null}
          format={fmtCount}
          spark={sparks?.activeTraders}
          color="var(--pos)"
        />
      </div>
      <div className="min-h-0 flex-1">
        <RevenueCard />
      </div>
    </div>
  );
}

function MetricMiniCard({ label, value, format, spark, color }: {
  label: string; value: number | null; format: (n: number) => string; spark?: Spark; color: string;
}) {
  const data = useMemo(() => (spark?.series ?? []).map((v, i) => ({ i, v })), [spark]);
  const change = spark?.changePct ?? null;
  const gid = `grad-${label.replace(/\s+/g, '')}`;
  return (
    // ASXN-style: big number + change over a full-bleed area chart backdrop
    // pinned to the card's lower edge (absolute, so it can't grow the card).
    <div className="glass-card relative flex h-full flex-col overflow-hidden p-4">
      {data.length >= 2 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[54%] opacity-95">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="relative z-10">
        <div className="truncate text-[12px] font-medium text-[var(--role-content-subtle)]">{label}</div>
        <div className="mt-1.5 text-[28px] font-medium font-sans leading-none tracking-tight tabular-nums text-[var(--role-content)] sm:text-[32px]">
          {value == null ? <span className="text-[var(--role-content-subtle)]">—</span> : <AnimatedNumber value={value} format={format} />}
        </div>
        {change != null && Number.isFinite(change) && (
          <div className="mt-1.5 text-[12px] tabular-nums">
            <span className="text-[var(--role-content-subtle)]">24h </span>
            <span className={cn('font-semibold', change >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const REV_RANGES: { label: string; days: number }[] = [
  { label: '7D', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: 'ALL', days: Infinity },
];

function RevenueCard() {
  const { network } = useCurrentNetwork();
  const [days, setDays] = useState(30);
  // Fetch the full daily revenue history ONCE. The headline stats (cumulative,
  // daily-avg, annualized) are derived from ALL of it — so they're identical on
  // every timeframe — and the timeframe pills only slice the bar window.
  const [allRows, setAllRows] = useState<{ timestamp: string; periodRevenue: number; cumulativeRevenue: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    analytics.getProtocolRevenueChart(8760 * 3) // ALL → daily buckets
      .then((d) => { if (!cancelled) setAllRows(Array.isArray(d?.data) ? d.data : []); })
      .catch(() => { if (!cancelled) setAllRows([]); });
    return () => { cancelled = true; };
  }, [network]);

  // Constant stats from the full history: cumulative = current running total;
  // daily avg = cumulative / actual days elapsed (one daily bucket ≈ one day).
  const cumulative = allRows.length ? allRows[allRows.length - 1].cumulativeRevenue : 0;
  const totalDays = allRows.length || 1;
  const dailyAvg = cumulative / totalDays;
  const annualized = dailyAvg * 365;

  const bars = useMemo(
    () => (days === Infinity ? allRows : allRows.slice(-days)).map((r) => ({ t: r.timestamp, v: Math.max(0, r.periodRevenue || 0) })),
    [allRows, days],
  );
  const fmtAxis = (ts: string) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="glass-card flex h-full flex-col overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium text-[var(--role-content-subtle)]">Revenue</div>
          <div className="mt-1 text-[26px] font-medium font-sans leading-none tracking-tight tabular-nums text-[var(--role-content)] sm:text-[30px]">
            {allRows.length === 0 ? <span className="text-[var(--role-content-subtle)]">—</span> : <AnimatedNumber value={cumulative} format={fmtUsd} />}
          </div>
          <div className="mt-2 flex gap-5">
            <SubStat label="Annualized" value={fmtUsd(annualized)} />
            <SubStat label="Daily Avg" value={fmtUsd(dailyAvg)} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--role-surface-raised)]/60 p-0.5">
          {REV_RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setDays(r.days)}
              className={cn('rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                days === r.days ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1">
        {bars.length < 1 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--role-content-subtle)]">No revenue data yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
              <XAxis dataKey="t" tickFormatter={fmtAxis} tick={{ fill: 'var(--role-content-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis tick={{ fill: 'var(--role-content-subtle)', fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${formatCompact(Number(v))}`} />
              <Tooltip
                cursor={{ fill: 'var(--role-surface-raised)', opacity: 0.4 }}
                contentStyle={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}
                labelFormatter={(t) => new Date(t as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                formatter={(v: number) => [`$${formatCompact(Number(v))}`, 'Revenue']}
              />
              <Bar dataKey="v" fill="var(--pos)" radius={[2, 2, 0, 0]} maxBarSize={30} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums text-[var(--role-content)]">{value}</div>
    </div>
  );
}
