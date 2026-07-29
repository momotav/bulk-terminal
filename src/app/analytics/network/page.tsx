'use client';

// Analytics · Network
//
// Live + historical view of the BULK chain itself (as opposed to the exchange
// data on the other analytics pages). All figures are real BULK data:
//   - Live KPIs come from /explorer/throughput (rolling 60s).
//   - Live Throughput chart is seeded from the last hour of /network-history at
//     minute resolution, refreshed every 15s (full on arrival, no per-tick
//     client accumulation).
//   - Historical Block-Time / Throughput come from /explorer/network-history,
//     and Operations/Transactions by Type from /explorer/action-history — both
//     aggregated from the 60s snapshots the backend records, so they build
//     forward from first deploy (empty at first, by design; no backfill).
//
// Styled to match the other analytics pages (StatCard KPIs, ChartFrame panels,
// recharts, the palette + four themes).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, Line, LineChart, ReferenceLine, Scatter, ScatterChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { Radio, Timer } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { ChartFrame } from '@/components/ChartFrame';
import { ResizableChart } from '@/components/ResizableChart';
import { ResizableChartRow } from '@/components/ResizableChartRow';
import {
  explorer, formatCompact, formatNumber,
  type ExplorerThroughput, type NetworkHistoryPoint, type ActionHistoryPoint, type ExplorerBlock,
  type NetworkStats, type HeatmapCell, type BlockMetricPoint,
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
// Cx/cx/CxA = cancel, px = price/oracle update). Anything else buckets to Other
// so the split is always honest rather than guessing at unknown codes.
type CatKey = 'order' | 'cancel' | 'price' | 'other';
const CATEGORIES: { key: CatKey; label: string; color: string }[] = [
  { key: 'order', label: 'Orders', color: 'var(--coin-1)' },
  { key: 'cancel', label: 'Cancels', color: 'var(--coin-3)' },
  { key: 'price', label: 'Price Updates', color: 'var(--coin-2)' },
  { key: 'other', label: 'Other', color: 'var(--coin-5)' },
];
function categoryOf(code: string): CatKey {
  if (code === 'l' || code === 'L' || code === 'M') return 'order';
  if (code === 'cx' || code === 'Cx' || code === 'cxa' || code === 'CxA') return 'cancel';
  if (code === 'px') return 'price';
  return 'other';
}
// Pivot per-code history rows into one stacked-bar row per time bucket.
type TypeRow = { bucket: string; order: number; cancel: number; price: number; other: number };
function pivotByType(points: ActionHistoryPoint[], metric: 'ops' | 'txs'): TypeRow[] {
  const map = new Map<string, TypeRow>();
  for (const p of points) {
    let row = map.get(p.bucket);
    if (!row) { row = { bucket: p.bucket, order: 0, cancel: 0, price: 0, other: 0 }; map.set(p.bucket, row); }
    row[categoryOf(p.code)] += metric === 'ops' ? p.ops : p.txs;
  }
  return [...map.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
}

// Shared chart-tooltip + hover-cursor styling, matching the other analytics
// pages (bar cursor is a faint text-primary wash, not the recharts default
// light-gray box that reads as "white" on the dark theme).
const BAR_CURSOR = { fill: 'var(--text-primary)', opacity: 0.06 };

// Value formatters + dataKey→label maps for the shared tooltip below.
const fmtPerSec = (v: number) => formatCompact(v);
const fmtMs = (v: number) => `${formatNumber(v, 2)} ms`;
const fmtPct = (v: number) => `${formatNumber(v, 1)}%`;
const fmtCount = (v: number) => formatCompact(v);
const NM_THROUGHPUT: Record<string, string> = { tps: 'Transactions/s', aps: 'Operations/s' };
const NM_BLOCKTIME: Record<string, string> = { block_time_ms: 'Block time' };
const NM_PCTL: Record<string, string> = { bt_p50: 'P50', bt_p95: 'P95', bt_p99: 'P99' };
const NM_EMPTY: Record<string, string> = { filled: 'Non-empty', empty: 'Empty' };
const NM_BYTYPE: Record<string, string> = { order: 'Orders', cancel: 'Cancels', price: 'Price Updates', other: 'Other' };
const NM_BLOCKS: Record<string, string> = { tx: 'Transactions', actions: 'Operations' };

// Chart tooltip matching the other analytics pages: dated header + separator,
// then a colour swatch + name on the left and a right-aligned value.
function NetTooltip({ active, payload, label, nameMap, fmt, labelText }: {
  active?: boolean;
  payload?: any[];
  label?: any;
  nameMap?: Record<string, string>;
  fmt: (v: number) => string;
  labelText?: (label: any) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3 shadow-xl min-w-[168px]">
      {labelText && label != null && (
        <p className="text-xs text-[var(--text-secondary)] mb-2 border-b border-[var(--border-color)] pb-2">{labelText(label)}</p>
      )}
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: entry.color || entry.fill }} />
            <span className="text-[var(--text-secondary)]">{nameMap?.[entry.dataKey] ?? entry.name ?? entry.dataKey}</span>
          </div>
          <span className="text-[var(--text-primary)] font-medium tabular-nums">{fmt(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Tooltip for the TPS-vs-block-time scatter (a single x/y point, two units).
// Explicit theme colours so the text is never black on the dark theme.
function ScatterTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  const p = active && payload?.length ? payload[0]?.payload : null;
  if (!p) return null;
  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3 shadow-xl">
      <div className="flex items-center justify-between gap-4 text-xs py-0.5">
        <span className="text-[var(--text-secondary)]">Throughput</span>
        <span className="text-[var(--text-primary)] font-medium tabular-nums">{formatNumber(p.tps, 0)} TPS</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-xs py-0.5">
        <span className="text-[var(--text-secondary)]">Block time</span>
        <span className="text-[var(--text-primary)] font-medium tabular-nums">{formatNumber(p.bt, 2)} ms</span>
      </div>
    </div>
  );
}

export default function NetworkPage() {
  const { network } = useCurrentNetwork();

  // Live KPI snapshot + a seeded last-hour throughput series.
  const [tp, setTp] = useState<ExplorerThroughput | null>(null);
  const [liveHist, setLiveHist] = useState<NetworkHistoryPoint[] | null>(null);

  // Historical block-time / throughput.
  const [range, setRange] = useState<Range>('7d');
  const [history, setHistory] = useState<NetworkHistoryPoint[] | null>(null);

  // By-type stacked bars (own range) + recent blocks.
  const [byTypeRange, setByTypeRange] = useState<Range>('7d');
  const [actionHist, setActionHist] = useState<ActionHistoryPoint[] | null>(null);
  const [blocks, setBlocks] = useState<ExplorerBlock[] | null>(null);

  // Summary stats (peaks/percentiles), activity heatmap, per-block detail.
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapCell[] | null>(null);
  const [blockRange, setBlockRange] = useState<Range>('7d');
  const [blockMetrics, setBlockMetrics] = useState<BlockMetricPoint[] | null>(null);

  // KPI tiles — poll live throughput every 3s.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const t = await explorer.getThroughput(); if (alive) setTp(t); } catch { /* keep last good */ }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [network]);

  // Live Throughput chart — seed with the last hour at minute resolution so it
  // renders full immediately, then refresh every 15s. One small request per
  // refresh, no per-tick client accumulation, so it doesn't tax the page.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const r = await explorer.getNetworkHistory('1h'); if (alive) setLiveHist(r.points || []); } catch { /* keep last */ }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [network]);

  // Recent blocks (6s).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const r = await explorer.getRecentBlocks(40); if (alive) setBlocks(r.blocks); } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 6000);
    return () => { alive = false; clearInterval(id); };
  }, [network]);

  // Historical block-time / throughput on range change.
  useEffect(() => {
    let alive = true;
    setHistory(null);
    explorer.getNetworkHistory(range)
      .then((r) => { if (alive) setHistory(r.points || []); })
      .catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [range, network]);

  // By-type action/transaction history on its own range.
  useEffect(() => {
    let alive = true;
    setActionHist(null);
    explorer.getActionHistory(byTypeRange)
      .then((r) => { if (alive) setActionHist(r.points || []); })
      .catch(() => { if (alive) setActionHist([]); });
    return () => { alive = false; };
  }, [byTypeRange, network]);

  // Summary stats (today) + activity heatmap (14d), refreshed periodically.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const s = await explorer.getNetworkStats('1d'); if (alive) setStats(s); } catch { /* keep last */ }
      try { const h = await explorer.getNetworkHeatmap(14); if (alive) setHeatmap(h.cells || []); } catch { /* keep last */ }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [network]);

  // Per-block detail on its own range.
  useEffect(() => {
    let alive = true;
    setBlockMetrics(null);
    explorer.getBlockMetrics(blockRange)
      .then((r) => { if (alive) setBlockMetrics(r.points || []); })
      .catch(() => { if (alive) setBlockMetrics([]); });
    return () => { alive = false; };
  }, [blockRange, network]);

  // Derived values.
  const actionsPerTx = tp && tp.tps > 0 ? tp.aps / tp.tps : null;
  const statusOk = (tp?.status || '').toLowerCase().includes('oper') || (tp?.status || '').toLowerCase() === 'live';

  const opsByType = useMemo(() => (actionHist ? pivotByType(actionHist, 'ops') : null), [actionHist]);
  const txByType = useMemo(() => (actionHist ? pivotByType(actionHist, 'txs') : null), [actionHist]);

  const blockBars = useMemo(() => {
    if (!blocks) return [];
    // Oldest→newest so the chart reads left-to-right in time.
    return [...blocks].reverse().map((b) => ({
      round: b.round,
      tx: b.txCount,
      actions: b.actionCount,
    }));
  }, [blocks]);

  // Bucket label formatter — intra-day ranges show HH:MM, multi-day show Mon D.
  const fmtBucket = (b: string, r: Range | '1h') => {
    const d = new Date(b);
    return (r === '1h' || r === '1d')
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Empty-block % series (non-empty vs empty share per bucket).
  const emptyPct = useMemo(() => (blockMetrics ?? []).map((p) => {
    const total = p.total_blocks ?? 0;
    const empty = total > 0 ? ((p.empty_blocks ?? 0) / total) * 100 : 0;
    return { bucket: p.bucket, empty, filled: 100 - empty };
  }), [blockMetrics]);
  // TPS vs Block Time scatter, from the last-hour minute series.
  const scatter = useMemo(() => (liveHist ?? [])
    .filter((p) => p.tps != null && p.block_time_ms != null)
    .map((p) => ({ tps: p.tps as number, bt: p.block_time_ms as number })), [liveHist]);
  const medianBt = useMemo(() => {
    if (scatter.length === 0) return null;
    const s = scatter.map((p) => p.bt).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }, [scatter]);

  const hasHistory = (history?.length ?? 0) > 0;
  const hasLive = (liveHist?.length ?? 0) > 0;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center gap-3">
        <h1 className="page-title text-[var(--text-primary)]">Network</h1>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          title={tp ? (statusOk ? 'Operational' : (tp.status || 'Degraded')) : 'Connecting…'}
          style={{ backgroundColor: tp ? (statusOk ? 'var(--pos)' : 'var(--neg)') : 'var(--text-tertiary)' }}
        />
      </div>

      {/* KPI strip — live throughput + today's peak, one row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
        <StatCard size="compact" label="Transactions / sec" loading={!tp}
          value={tp ? formatNumber(tp.tps, tp.tps < 100 ? 1 : 0) : '-'} valueColor="var(--pos)" />
        <StatCard size="compact" label="Operations / sec" loading={!tp}
          value={tp ? formatCompact(tp.aps) : '-'} />
        <StatCard size="compact" label="Block time" unit="ms" loading={!tp}
          value={tp?.blockTimeMs != null ? formatNumber(tp.blockTimeMs, 1) : '-'} />
        <StatCard size="compact" label="Actions / tx" loading={!tp}
          value={actionsPerTx != null ? formatNumber(actionsPerTx, 1) : '-'} />
        <StatCard size="compact" label="Peak TPS today" loading={!stats}
          value={stats?.peak_tps != null ? formatNumber(stats.peak_tps, 0) : '-'} />
        <StatCard size="compact" label="Latest round" loading={!tp}
          value={tp?.latestRound != null ? tp.latestRound.toLocaleString() : '-'} />
      </div>

      {/* Live throughput — accumulates while the page is open */}
      <ResizableChart storageKey="network:live-throughput" defaultHeight={288}>
      <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Live Throughput</h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
            <Radio className="w-3.5 h-3.5 text-[var(--pos)]" /> Last hour
          </span>
        </div>
        {liveHist === null ? (
          <ChartSkeleton />
        ) : !hasLive ? (
          <CollectingState />
        ) : (
          <ChartFrame className="h-[var(--chart-h,288px)]" yLabel="per second"
            legend={[{ label: 'Transactions/s', color: 'var(--pos)' }, { label: 'Operations/s', color: 'var(--shade-3)' }]}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={liveHist} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
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
                <XAxis dataKey="bucket" tickFormatter={(b) => fmtBucket(b, '1h')} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--border-color)' }} minTickGap={40} />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--border-color)' }} width={44} />
                <Tooltip content={<NetTooltip nameMap={NM_THROUGHPUT} fmt={fmtPerSec}
                  labelText={(b) => new Date(b as string).toLocaleTimeString('en-US')} />} />
                <Area type="monotone" dataKey="aps" stroke="var(--shade-3)" strokeWidth={2} fill="url(#netOps)" isAnimationActive={false} />
                <Area type="monotone" dataKey="tps" stroke="var(--pos)" strokeWidth={2} fill="url(#netTps)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
        )}
      </div>
      </ResizableChart>

      {/* Activity heatmap — avg TPS by weekday × hour */}
      <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Activity Heatmap</h2>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">Average transactions per second by weekday and hour - brighter is busier.</p>
          </div>
        </div>
        {heatmap === null ? (
          <ChartSkeleton />
        ) : heatmap.length === 0 ? (
          <CollectingState />
        ) : (
          <TpsHeatmap cells={heatmap} />
        )}
      </div>

      {/* Historical block time + throughput */}
      <ResizableChartRow storageKey="network-blocktime-throughput" defaultHeight={288}>
        <Panel title="Block Times" right={<RangeToggle value={range} onChange={setRange} />}>
          {history === null ? (
            <ChartSkeleton />
          ) : !hasHistory ? (
            <CollectingState />
          ) : (
            <ChartFrame className="h-[var(--chart-h,288px)]" yLabel="Block time (ms)">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <XAxis dataKey="bucket" tickFormatter={(b) => fmtBucket(b, range)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} minTickGap={30} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} width={44}
                    domain={['auto', 'auto']} />
                  <Tooltip content={<NetTooltip nameMap={NM_BLOCKTIME} fmt={fmtMs}
                    labelText={(b) => fmtBucket(b as string, range)} />} />
                  <Line type="monotone" dataKey="block_time_ms" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}
        </Panel>
        <Panel title="Network Throughput" right={<RangeToggle value={range} onChange={setRange} />}>
          {history === null ? (
            <ChartSkeleton />
          ) : !hasHistory ? (
            <CollectingState />
          ) : (
            <ChartFrame className="h-[var(--chart-h,288px)]" yLabel="Avg per second"
              legend={[{ label: 'Transactions/s', color: 'var(--pos)' }, { label: 'Operations/s', color: 'var(--shade-3)' }]}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <defs>
                    <linearGradient id="netHistTps" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--pos)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--pos)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="bucket" tickFormatter={(b) => fmtBucket(b, range)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} minTickGap={30} />
                  <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} width={44} />
                  <Tooltip content={<NetTooltip nameMap={NM_THROUGHPUT} fmt={fmtPerSec}
                    labelText={(b) => fmtBucket(b as string, range)} />} />
                  <Area type="monotone" dataKey="aps" stroke="var(--shade-3)" strokeWidth={2} fillOpacity={0} isAnimationActive={false} />
                  <Area type="monotone" dataKey="tps" stroke="var(--pos)" strokeWidth={2} fill="url(#netHistTps)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}
        </Panel>
      </ResizableChartRow>

      {/* Block-time percentiles + empty-block share */}
      <ResizableChartRow storageKey="network-percentiles-empty" defaultHeight={288}>
        <Panel title="Block Time Percentiles" right={<RangeToggle value={blockRange} onChange={setBlockRange} />}>
          {blockMetrics === null ? <ChartSkeleton /> : blockMetrics.length === 0 ? <CollectingState /> : (
            <ChartFrame className="h-[var(--chart-h,288px)]" yLabel="Block time (ms)"
              legend={[{ label: 'P50', color: 'var(--coin-1)' }, { label: 'P95', color: 'var(--coin-3)' }, { label: 'P99', color: 'var(--coin-5)' }]}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={blockMetrics} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <XAxis dataKey="bucket" tickFormatter={(b) => fmtBucket(b as string, blockRange)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} minTickGap={30} />
                  <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }} axisLine={{ stroke: 'var(--border-color)' }} width={44} domain={['auto', 'auto']} />
                  <Tooltip content={<NetTooltip nameMap={NM_PCTL} fmt={fmtMs}
                    labelText={(b) => fmtBucket(b as string, blockRange)} />} />
                  <Line type="monotone" dataKey="bt_p50" stroke="var(--coin-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="bt_p95" stroke="var(--coin-3)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="bt_p99" stroke="var(--coin-5)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}
        </Panel>
        <Panel title="Empty vs Non-empty Blocks" right={<RangeToggle value={blockRange} onChange={setBlockRange} />}>
          {blockMetrics === null ? <ChartSkeleton /> : emptyPct.length === 0 ? <CollectingState /> : (
            <ChartFrame className="h-[var(--chart-h,288px)]" yLabel="% of blocks"
              legend={[{ label: 'Non-empty', color: 'var(--pos)' }, { label: 'Empty', color: 'var(--shade-3)' }]}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={emptyPct} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                  <XAxis dataKey="bucket" tickFormatter={(b) => fmtBucket(b as string, blockRange)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} minTickGap={30} />
                  <YAxis tickFormatter={(v) => `${Math.round(v)}%`} domain={[0, 100]} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--border-color)' }} width={40} />
                  <Tooltip content={<NetTooltip nameMap={NM_EMPTY} fmt={fmtPct}
                    labelText={(b) => fmtBucket(b as string, blockRange)} />} />
                  <Area type="monotone" dataKey="filled" stackId="b" stroke="var(--pos)" strokeWidth={1.5} fill="var(--pos)" fillOpacity={0.25} isAnimationActive={false} />
                  <Area type="monotone" dataKey="empty" stackId="b" stroke="var(--shade-3)" strokeWidth={1.5} fill="var(--shade-3)" fillOpacity={0.35} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartFrame>
          )}
        </Panel>
      </ResizableChartRow>

      {/* By-type composition — stacked bars over time (from sampled history) */}
      <ResizableChartRow storageKey="network-bytype" defaultHeight={256}>
        <ByTypePanel title="Operations by Type" data={opsByType} range={byTypeRange}
          onRange={setByTypeRange} fmt={fmtBucket} unit="operations" />
        <ByTypePanel title="Transactions by Type" data={txByType} range={byTypeRange}
          onRange={setByTypeRange} fmt={fmtBucket} unit="transactions" />
      </ResizableChartRow>

      {/* TPS vs Block Time — does the chain slow down under load? */}
      <ResizableChart storageKey="network:load-scatter" defaultHeight={256}>
      <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
        <div className="mb-4">
          <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Does load slow the chain?</h2>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            Each dot is one minute of the last hour - its throughput (across) vs. its block time (up).
            A flat cloud on the dashed baseline means block time holds steady as load rises: the network isn&apos;t congesting.
          </p>
        </div>
        {liveHist === null ? <ChartSkeleton /> : scatter.length === 0 ? <CollectingState /> : (
          <ChartFrame className="h-[var(--chart-h,256px)]" yLabel="Block time (ms)">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
                <XAxis type="number" dataKey="tps" name="Throughput" unit=" TPS" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--border-color)' }} domain={['dataMin - 5', 'dataMax + 5']}
                  label={{ value: 'Transactions / sec →', position: 'insideBottom', offset: -10, fill: 'var(--text-tertiary)', fontSize: 10 }} />
                <YAxis type="number" dataKey="bt" name="Block time" unit=" ms" tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--border-color)' }} width={48} domain={['auto', 'auto']} />
                <ZAxis range={[44, 44]} />
                {medianBt != null && (
                  <ReferenceLine y={medianBt} stroke="var(--accent)" strokeDasharray="4 4" strokeOpacity={0.7}
                    label={{ value: `median ${formatNumber(medianBt, 2)} ms`, position: 'insideTopRight', fill: 'var(--text-tertiary)', fontSize: 10 }} />
                )}
                <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-color)' }}
                  content={<ScatterTooltip />} />
                <Scatter data={scatter} fill="var(--accent)" fillOpacity={0.6} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartFrame>
        )}
      </div>
      </ResizableChart>

      {/* Recent block activity */}
      <ResizableChart storageKey="network:recent-blocks" defaultHeight={256}>
      <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Recent Block Activity</h2>
          <span className="text-[11px] text-[var(--text-tertiary)]">last {blockBars.length} blocks</span>
        </div>
        {!blocks ? (
          <ChartSkeleton />
        ) : (
          <ChartFrame className="h-[var(--chart-h,256px)]" yLabel="Per block"
            legend={[{ label: 'Transactions', color: 'var(--pos)' }, { label: 'Operations', color: 'var(--shade-3)' }]}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={blockBars} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="18%">
                <XAxis dataKey="round" tick={{ fill: 'var(--text-tertiary)', fontSize: 9 }}
                  axisLine={{ stroke: 'var(--border-color)' }} minTickGap={24}
                  tickFormatter={(r) => `#${(r as number).toLocaleString()}`} />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--border-color)' }} width={40} />
                <Tooltip cursor={BAR_CURSOR} content={<NetTooltip nameMap={NM_BLOCKS} fmt={fmtCount}
                  labelText={(r) => `Round #${(r as number).toLocaleString()}`} />} />
                <Bar dataKey="actions" fill="var(--shade-3)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="tx" fill="var(--pos)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
        )}
      </div>
      </ResizableChart>
    </div>
  );
}

// ── small building blocks ────────────────────────────────────────────────────

// Card shell used as a ResizableChartRow child: `isDragging` is injected by the
// row (subtle blur while a grip is held), and h-full/flex-col stretches the
// card to the row height so both charts in a pair line up.
function Panel({
  title, right, isDragging = false, children,
}: {
  title: string;
  right?: React.ReactNode;
  isDragging?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6 h-full flex flex-col min-w-0 overflow-hidden transition-all duration-300 ${isDragging ? 'blur-[1px] opacity-80' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
        {right}
      </div>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function RangeToggle({ value, onChange }: { value: Range; onChange: (v: Range) => void }) {
  return (
    <div className="flex items-center gap-0.5 md:gap-1 bg-[var(--bg-muted)] rounded-lg p-0.5 md:p-1 shrink-0">
      {RANGES.map((r) => (
        <button key={r.value} onClick={() => onChange(r.value)}
          className={`px-2 md:px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors ${
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
    <div className="h-[var(--chart-h,288px)] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
    </div>
  );
}

function CollectingState() {
  return (
    <div className="h-[var(--chart-h,288px)] flex flex-col items-center justify-center text-center px-6">
      <Timer className="w-9 h-9 mb-3 text-[var(--accent)] opacity-40" />
      <p className="text-[var(--text-secondary)]">Collecting network history…</p>
      <p className="text-xs mt-1 text-[var(--text-tertiary)] max-w-[36ch]">
        This chart fills in as snapshots accumulate. History builds forward from when recording started - there is no backfill.
      </p>
    </div>
  );
}

function ByTypePanel({
  title, data, range, onRange, fmt, unit, isDragging = false,
}: {
  title: string;
  data: TypeRow[] | null;
  range: Range;
  onRange: (r: Range) => void;
  fmt: (b: string, r: Range | '1h') => string;
  unit: string;
  /** Injected by ResizableChartRow while its grip is held. */
  isDragging?: boolean;
}) {
  const totals = useMemo(() => {
    const t: Record<CatKey, number> = { order: 0, cancel: 0, price: 0, other: 0 };
    for (const row of data ?? []) { t.order += row.order; t.cancel += row.cancel; t.price += row.price; t.other += row.other; }
    return t;
  }, [data]);
  const grand = totals.order + totals.cancel + totals.price + totals.other;
  const labelFor = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

  return (
    <div className={`bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6 h-full flex flex-col min-w-0 overflow-hidden transition-all duration-300 ${isDragging ? 'blur-[1px] opacity-80' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
        <RangeToggle value={range} onChange={onRange} />
      </div>
      {data === null ? (
        <ChartSkeleton />
      ) : data.length === 0 ? (
        <CollectingState />
      ) : (
        <>
          <ChartFrame className="h-[var(--chart-h,256px)]" legend={CATEGORIES.map((c) => ({ label: c.label, color: c.color }))}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="18%">
                <XAxis dataKey="bucket" tickFormatter={(b) => fmt(b as string, range)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--border-color)' }} minTickGap={24} />
                <YAxis tickFormatter={(v) => formatCompact(v)} tick={{ fill: 'var(--text-tertiary)', fontSize: 10 }}
                  axisLine={{ stroke: 'var(--border-color)' }} width={44} />
                <Tooltip cursor={BAR_CURSOR} content={<NetTooltip nameMap={NM_BYTYPE} fmt={fmtCount}
                  labelText={(b) => fmt(b as string, range)} />} />
                <Bar dataKey="order" stackId="s" fill={CATEGORIES[0].color} isAnimationActive={false} />
                <Bar dataKey="cancel" stackId="s" fill={CATEGORIES[1].color} isAnimationActive={false} />
                <Bar dataKey="price" stackId="s" fill={CATEGORIES[2].color} isAnimationActive={false} />
                <Bar dataKey="other" stackId="s" fill={CATEGORIES[3].color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
          {/* Legend + share of total over the selected range. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
            {CATEGORIES.map((c) => (
              <div key={c.key} className="flex items-center gap-1.5 text-[11px]">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
                <span className="text-[var(--text-secondary)]">{c.label}</span>
                <span className="font-mono tabular-nums text-[var(--text-tertiary)]">
                  {grand > 0 ? `${formatNumber((totals[c.key] / grand) * 100, 0)}%` : '-'}
                </span>
              </div>
            ))}
            <span className="text-[11px] text-[var(--text-tertiary)] ml-auto">{formatCompact(grand)} {unit}</span>
          </div>
        </>
      )}
    </div>
  );
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function TpsHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const map = new Map<string, number>();
  let max = 0;
  for (const c of cells) {
    map.set(`${c.dow}-${c.hour}`, c.tps);
    if (c.tps > max) max = c.tps;
  }
  // Blend the accent over the base surface by intensity (0 = empty cell).
  const cellColor = (v: number | undefined) => {
    if (v == null) return 'var(--bg-base)';
    const t = max > 0 ? Math.min(1, v / max) : 0;
    return `color-mix(in srgb, var(--accent) ${Math.round(t * 100)}%, var(--bg-base))`;
  };
  const hh = (h: number) => String(h).padStart(2, '0');

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ text: string; sub: string; left: number; top: number; below: boolean } | null>(null);

  return (
    <div ref={wrapRef} className="relative overflow-x-auto custom-scrollbar" onMouseLeave={() => setHover(null)}>
      <div className="min-w-[680px]">
        <div className="flex items-center gap-1 mb-1 pl-8">
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="flex-1 text-center text-[9px] text-[var(--text-tertiary)] tabular-nums">
              {h % 3 === 0 ? hh(h) : ''}
            </div>
          ))}
        </div>
        {DOW_LABELS.map((label, dow) => (
          <div key={dow} className="flex items-center gap-1 mb-1">
            <div className="w-7 shrink-0 text-[10px] text-[var(--text-tertiary)]">{label}</div>
            {Array.from({ length: 24 }).map((_, h) => {
              const v = map.get(`${dow}-${h}`);
              return (
                <div
                  key={h}
                  className="flex-1 aspect-square rounded-[2px] border border-[var(--border-color)]/40 transition-[filter] duration-100 hover:brightness-125"
                  style={{ backgroundColor: cellColor(v) }}
                  onMouseEnter={(e) => {
                    const wrap = wrapRef.current;
                    if (!wrap) return;
                    const cr = e.currentTarget.getBoundingClientRect();
                    const wr = wrap.getBoundingClientRect();
                    const cellTop = cr.top - wr.top;
                    // Not enough room above (top rows) → drop the tooltip below
                    // the cell so the scroll container doesn't clip it.
                    const below = cellTop < 64;
                    setHover({
                      text: v != null ? `${formatNumber(v, 0)} TPS` : 'No data yet',
                      sub: `${label} · ${hh(h)}:00`,
                      left: cr.left - wr.left + cr.width / 2,
                      top: below ? cellTop + cr.height + 6 : cellTop - 6,
                      below,
                    });
                  }}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-3 pl-8 text-[10px] text-[var(--text-tertiary)]">
          <span>low</span>
          <div className="h-2 w-24 rounded" style={{ background: 'linear-gradient(to right, var(--bg-base), var(--accent))' }} />
          <span>high</span>
          <span className="ml-auto tabular-nums">peak {formatNumber(max, 0)} TPS</span>
        </div>
      </div>

      {hover && (
        <div className="pointer-events-none absolute z-20"
          style={{ left: hover.left, top: hover.top, transform: hover.below ? 'translateX(-50%)' : 'translate(-50%, -100%)' }}>
          <div className="glass-tooltip whitespace-nowrap rounded-lg px-2.5 py-1.5">
            <div className="text-[11px] text-[var(--text-secondary)]">{hover.sub}</div>
            <div className="text-xs font-semibold tabular-nums text-[var(--text-primary)]">{hover.text}</div>
          </div>
        </div>
      )}
    </div>
  );
}
