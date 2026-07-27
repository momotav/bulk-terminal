'use client';

// Analytics · Network
//
// Live + historical view of the BULK chain itself (as opposed to the exchange
// data on the other analytics pages). All figures are real BULK data:
//   - Live KPIs + live throughput come from /explorer/throughput (rolling 60s).
//   - Historical Block-Time / Throughput come from /explorer/network-history,
//     aggregated from the 60s snapshots the backend records — so they build
//     forward from first deploy (empty at first, by design; no backfill).
//   - Operations/Transactions by Type come from /explorer/action-breakdown,
//     a live sample of recent block detail classified by action code.
//
// Styled to match the other analytics pages (StatCard KPIs, ChartFrame panels,
// recharts, the palette + four themes).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Radio, Timer } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { ChartFrame } from '@/components/ChartFrame';
import {
  explorer, formatCompact, formatNumber,
  type ExplorerThroughput, type NetworkHistoryPoint, type ActionBreakdown, type ExplorerBlock,
} from '@/lib/api';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

type Range = '1d' | '7d' | '30d';
const RANGES: { value: Range; label: string }[] = [
  { value: '1d', label: '1D' },
  { value: '7d', label: 'W' },
  { value: '30d', label: 'M' },
];

// Action-code → category. Codes are BULK's raw action strings; meanings come
// from the shared explorer dictionary (L/l = limit order, M = market order,
// Cx/cx = cancel, px = price/oracle update). Anything else buckets to Other so
// the split is always honest rather than guessing at unknown codes.
type CatKey = 'order' | 'cancel' | 'price' | 'other';
const CATEGORIES: { key: CatKey; label: string; color: string }[] = [
  { key: 'order', label: 'Orders', color: 'var(--coin-1)' },
  { key: 'cancel', label: 'Cancels', color: 'var(--coin-3)' },
  { key: 'price', label: 'Price Updates', color: 'var(--coin-2)' },
  { key: 'other', label: 'Other', color: 'var(--coin-5)' },
];
const CAT_COLOR: Record<CatKey, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.color]),
) as Record<CatKey, string>;
function categoryOf(code: string): CatKey {
  if (code === 'l' || code === 'L' || code === 'M') return 'order';
  if (code === 'cx' || code === 'Cx') return 'cancel';
  if (code === 'px') return 'price';
  return 'other';
}
function bucketByCategory(counts: Record<string, number>): { key: CatKey; label: string; value: number; color: string }[] {
  const totals: Record<CatKey, number> = { order: 0, cancel: 0, price: 0, other: 0 };
  for (const [code, n] of Object.entries(counts || {})) totals[categoryOf(code)] += n;
  return CATEGORIES
    .map((c) => ({ key: c.key, label: c.label, value: totals[c.key], color: c.color }))
    .filter((c) => c.value > 0);
}

const MAX_LIVE_POINTS = 60; // ~2.5 min of live throughput at a 2.5s cadence

export default function NetworkPage() {
  const { network } = useCurrentNetwork();

  // Live throughput snapshot + a client-accumulated session series.
  const [tp, setTp] = useState<ExplorerThroughput | null>(null);
  const [live, setLive] = useState<{ t: number; tps: number; ops: number }[]>([]);
  const liveRef = useRef<{ t: number; tps: number; ops: number }[]>([]);

  // Historical metrics + live composition + recent blocks.
  const [range, setRange] = useState<Range>('7d');
  const [history, setHistory] = useState<NetworkHistoryPoint[] | null>(null);
  const [breakdown, setBreakdown] = useState<ActionBreakdown | null>(null);
  const [blocks, setBlocks] = useState<ExplorerBlock[] | null>(null);

  // Poll live throughput (2.5s) and accumulate a rolling session series.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const t = await explorer.getThroughput();
        if (!alive) return;
        setTp(t);
        if (t.sampleCount >= 2) {
          const next = [...liveRef.current, { t: Date.now(), tps: t.tps, ops: t.aps }].slice(-MAX_LIVE_POINTS);
          liveRef.current = next;
          setLive(next);
        }
      } catch { /* transient — keep last good value */ }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [network]);

  // Recent blocks (6s) and live by-type composition (20s).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const r = await explorer.getRecentBlocks(40); if (alive) setBlocks(r.blocks); } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 6000);
    return () => { alive = false; clearInterval(id); };
  }, [network]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const b = await explorer.getActionBreakdown(); if (alive) setBreakdown(b); } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [network]);

  // Historical series on range / network change.
  useEffect(() => {
    let alive = true;
    setHistory(null);
    explorer.getNetworkHistory(range)
      .then((r) => { if (alive) setHistory(r.points || []); })
      .catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [range, network]);

  // Derived values.
  const actionsPerTx = tp && tp.tps > 0 ? tp.aps / tp.tps : null;
  const statusOk = (tp?.status || '').toLowerCase().includes('oper') || (tp?.status || '').toLowerCase() === 'live';

  const opsDonut = useMemo(() => bucketByCategory(breakdown?.opsByCode || {}), [breakdown]);
  const txDonut = useMemo(() => bucketByCategory(breakdown?.txByCode || {}), [breakdown]);

  const blockBars = useMemo(() => {
    if (!blocks) return [];
    // Oldest→newest so the chart reads left-to-right in time.
    return [...blocks].reverse().map((b) => ({
      round: b.round,
      tx: b.txCount,
      actions: b.actionCount,
    }));
  }, [blocks]);

  const xTickFmt = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const bucketFmt = (b: string) => {
    const d = new Date(b);
    return range === '1d'
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const hasHistory = (history?.length ?? 0) > 0;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-title text-[var(--text-primary)]">Network</h1>
        <span className="inline-flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: statusOk ? 'var(--pos)' : 'var(--neg)' }}
          />
          {tp ? (statusOk ? 'Operational' : (tp.status || 'Degraded')) : 'Connecting…'}
          <span className="opacity-50">·</span>
          BULK chain
        </span>
      </div>

      {/* KPI strip — all live from /throughput */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
        <StatCard size="compact" label="Transactions / sec" loading={!tp}
          value={tp ? formatNumber(tp.tps, tp.tps < 100 ? 1 : 0) : '—'} valueColor="var(--pos)" />
        <StatCard size="compact" label="Operations / sec" loading={!tp}
          value={tp ? formatCompact(tp.aps) : '—'} />
        <StatCard size="compact" label="Block time" unit="ms" loading={!tp}
          value={tp?.blockTimeMs != null ? formatNumber(tp.blockTimeMs, 1) : '—'} />
        <StatCard size="compact" label="Actions / tx" loading={!tp}
          value={actionsPerTx != null ? formatNumber(actionsPerTx, 1) : '—'} />
        <StatCard size="compact" label="Latest round" loading={!tp}
          value={tp?.latestRound != null ? tp.latestRound.toLocaleString() : '—'} />
        <StatCard size="compact" label="Blocks / window" loading={!tp}
          value={tp ? tp.sampleCount.toLocaleString() : '—'}
          sub={tp ? `over ${tp.windowSeconds}s` : undefined} />
      </div>

      {/* Live throughput — accumulates while the page is open */}
      <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Live Throughput</h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
            <Radio className="w-3.5 h-3.5" /> live · this session
          </span>
        </div>
        <ChartFrame className="h-64 md:h-72" yLabel="per second"
          legend={[{ label: 'Transactions/s', color: 'var(--pos)' }, { label: 'Operations/s', color: 'var(--shade-3)' }]}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={live} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="netTps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--pos)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--pos)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="netOps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--shade-3)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--shade-3)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tickFormatter={xTickFmt} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                axisLine={{ stroke: 'var(--border-color)' }} minTickGap={40} />
              <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                axisLine={{ stroke: 'var(--border-color)' }} width={44} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                labelFormatter={(ts) => new Date(ts as number).toLocaleTimeString('en-US')}
                formatter={(v: number, name) => [formatNumber(v, 1), name === 'ops' ? 'Operations/s' : 'Transactions/s']} />
              <Area type="monotone" dataKey="ops" stroke="var(--shade-3)" strokeWidth={2} fill="url(#netOps)" isAnimationActive={false} />
              <Area type="monotone" dataKey="tps" stroke="var(--pos)" strokeWidth={2} fill="url(#netTps)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      {/* Historical block time + throughput */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Block Times</h2>
            <RangeToggle value={range} onChange={setRange} />
          </div>
          {history === null ? (
            <ChartSkeleton />
          ) : !hasHistory ? (
            <CollectingState />
          ) : (
            <ChartFrame className="h-64 md:h-72" yLabel="Block time (ms)">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <XAxis dataKey="bucket" tickFormatter={bucketFmt} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} minTickGap={30} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} width={44}
                    domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                    labelStyle={{ color: 'var(--text-secondary)' }} labelFormatter={bucketFmt}
                    formatter={(v: number) => [`${formatNumber(v, 1)} ms`, 'Block time']} />
                  <Line type="monotone" dataKey="block_time_ms" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}
        </div>

        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Network Throughput</h2>
            <RangeToggle value={range} onChange={setRange} />
          </div>
          {history === null ? (
            <ChartSkeleton />
          ) : !hasHistory ? (
            <CollectingState />
          ) : (
            <ChartFrame className="h-64 md:h-72" yLabel="Avg per second"
              legend={[{ label: 'Transactions/s', color: 'var(--pos)' }, { label: 'Operations/s', color: 'var(--shade-3)' }]}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <defs>
                    <linearGradient id="netHistTps" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--pos)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--pos)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="bucket" tickFormatter={bucketFmt} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} minTickGap={30} />
                  <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} width={44} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                    labelStyle={{ color: 'var(--text-secondary)' }} labelFormatter={bucketFmt}
                    formatter={(v: number, name) => [formatNumber(v, 1), name === 'aps' ? 'Operations/s' : 'Transactions/s']} />
                  <Area type="monotone" dataKey="aps" stroke="var(--shade-3)" strokeWidth={2} fillOpacity={0} isAnimationActive={false} />
                  <Area type="monotone" dataKey="tps" stroke="var(--pos)" strokeWidth={2} fill="url(#netHistTps)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}
        </div>
      </div>

      {/* By-type composition — live sample of recent blocks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <DonutPanel title="Operations by Type" data={opsDonut} total={breakdown?.opsSampled ?? 0}
          loading={!breakdown} sampledBlocks={breakdown?.blocksSampled ?? 0} unit="operations" />
        <DonutPanel title="Transactions by Type" data={txDonut} total={breakdown?.txSampled ?? 0}
          loading={!breakdown} sampledBlocks={breakdown?.blocksSampled ?? 0} unit="transactions" />
      </div>

      {/* Recent block activity */}
      <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Recent Block Activity</h2>
          <span className="text-[11px] text-[var(--text-tertiary)]">last {blockBars.length} blocks</span>
        </div>
        {!blocks ? (
          <ChartSkeleton />
        ) : (
          <ChartFrame className="h-56 md:h-64" yLabel="Per block"
            legend={[{ label: 'Transactions', color: 'var(--pos)' }, { label: 'Operations', color: 'var(--shade-3)' }]}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={blockBars} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="18%">
                <XAxis dataKey="round" tick={{ fill: 'var(--text-tertiary)', fontSize: 9 }}
                  axisLine={{ stroke: 'var(--border-color)' }} minTickGap={24}
                  tickFormatter={(r) => `#${(r as number).toLocaleString()}`} />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--border-color)' }} width={40} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--text-secondary)' }} labelFormatter={(r) => `Round #${(r as number).toLocaleString()}`}
                  formatter={(v: number, name) => [formatNumber(v, 0), name === 'actions' ? 'Operations' : 'Transactions']} />
                <Bar dataKey="actions" fill="var(--shade-3)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="tx" fill="var(--pos)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        )}
      </div>
    </div>
  );
}

// ── small building blocks ────────────────────────────────────────────────────

function RangeToggle({ value, onChange }: { value: Range; onChange: (v: Range) => void }) {
  return (
    <div className="flex items-center gap-0.5 md:gap-1 bg-[var(--bg-muted)] rounded-lg p-0.5 md:p-1 shrink-0 border border-[var(--border-color)]">
      {RANGES.map((r) => (
        <button key={r.value} onClick={() => onChange(r.value)}
          className={`px-2.5 md:px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors ${
            value === r.value
              ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-64 md:h-72 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
    </div>
  );
}

function CollectingState() {
  return (
    <div className="h-64 md:h-72 flex flex-col items-center justify-center text-center px-6">
      <Timer className="w-9 h-9 mb-3 text-[var(--accent)] opacity-40" />
      <p className="text-[var(--text-secondary)]">Collecting network history…</p>
      <p className="text-xs mt-1 text-[var(--text-tertiary)] max-w-[36ch]">
        This chart fills in as snapshots accumulate. History builds forward from when recording started — there is no backfill.
      </p>
    </div>
  );
}

function DonutPanel({
  title, data, total, loading, sampledBlocks, unit,
}: {
  title: string;
  data: { key: CatKey; label: string; value: number; color: string }[];
  total: number;
  loading: boolean;
  sampledBlocks: number;
  unit: string;
}) {
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return (
    <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
        <span className="text-[11px] text-[var(--text-tertiary)]">sample · {sampledBlocks} blocks</span>
      </div>
      {loading ? (
        <ChartSkeleton />
      ) : data.length === 0 ? (
        <div className="h-64 md:h-72 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
          No recent activity to sample
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="w-full sm:w-1/2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%"
                  innerRadius="58%" outerRadius="85%" paddingAngle={1.5} stroke="var(--bg-muted)" strokeWidth={2}
                  isAnimationActive={false}>
                  {data.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8 }}
                  formatter={(v: number, _n, p: any) => [`${formatCompact(v)} (${formatNumber(pct(v), 1)}%)`, p?.payload?.label]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="w-full sm:w-1/2 space-y-2">
            {data.map((d) => (
              <div key={d.key} className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
                <span className="text-sm text-[var(--text-secondary)] flex-1 truncate">{d.label}</span>
                <span className="text-sm font-mono tabular-nums text-[var(--text-primary)]">{formatNumber(pct(d.value), 1)}%</span>
                <span className="text-xs font-mono tabular-nums text-[var(--text-tertiary)] w-16 text-right">{formatCompact(d.value)}</span>
              </div>
            ))}
            <p className="text-[11px] text-[var(--text-tertiary)] pt-1">
              {formatCompact(total)} {unit} sampled
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
