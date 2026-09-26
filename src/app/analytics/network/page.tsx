'use client';

// Analytics · Network — BULK sequencer performance & protocol health.
//
// Powered by BULK's executor /metrics endpoint (via our /performance and
// /performance-history routes): consensus latency, round throughput, order
// submissions, active/total accounts, reward pool, and node health. The live
// figures poll every few seconds; the trend charts are built from the snapshots
// we record every 5 minutes, so they fill in going forward.

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HeroKpi } from '@/components/HeroKpi';
import { ChartFrame } from '@/components/ChartFrame';
import { ResizableChart } from '@/components/ResizableChart';
import { ResizableChartRow } from '@/components/ResizableChartRow';
import { InteractiveRangeSlider, sliceByRange } from '@/components/InteractiveRangeSlider';
import { analytics, formatCompact, type PerformanceLive, type PerformancePoint } from '@/lib/api';
import { useIsMobile } from '@/hooks/useIsMobile';

const fmtMs = (n: number) => `${n.toFixed(2)} ms`;
const fmtInt = (n: number) => Math.round(n).toLocaleString();

export default function NetworkPage() {
  const isMobile = useIsMobile();
  const [live, setLive] = useState<PerformanceLive | null>(null);
  const [hist, setHist] = useState<PerformancePoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadLive = () => analytics.getPerformance().then((d) => { if (!cancelled && d) setLive(d); });
    const loadHist = () => analytics.getPerformanceHistory(168).then((d) => { if (!cancelled) setHist(d); });
    loadLive(); loadHist();
    const a = window.setInterval(loadLive, 5000);
    const b = window.setInterval(loadHist, 60000);
    return () => { cancelled = true; window.clearInterval(a); window.clearInterval(b); };
  }, []);

  // Sparkline series (last 40 hourly points) for the KPI cards.
  const spark = useMemo(() => {
    const tail = hist.slice(-40);
    // Rounds/sec has no stored column — derive it from the round-height delta
    // between consecutive snapshots so its KPI shows a real trend, not latency.
    const rounds: number[] = [];
    for (let i = 1; i < tail.length; i++) {
      const a = tail[i - 1], b = tail[i];
      if (a.roundHeight != null && b.roundHeight != null) {
        const dt = (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
        if (dt > 0) {
          const r = (b.roundHeight - a.roundHeight) / dt;
          if (r >= 0 && Number.isFinite(r)) rounds.push(r);
        }
      }
    }
    return {
      latency: tail.map((p) => p.latencyMedianMs ?? 0).filter((v) => v > 0),
      rounds,
      active: tail.map((p) => p.activeAccounts ?? 0).filter((v) => v > 0),
      total: tail.map((p) => p.totalAccounts ?? 0).filter((v) => v > 0),
      reward: tail.map((p) => (p.rewardPool ?? 0) / 1e9).filter((v) => v > 0),
    };
  }, [hist]);

  // Drop the empty leading points (early snapshots recorded before a given
  // metric column existed have nulls) so charts don't start with a blank gap.
  const histLatency = useMemo(() => hist.filter((p) => p.latencyMedianMs != null), [hist]);
  const histAccounts = useMemo(() => hist.filter((p) => p.totalAccounts != null || p.activeAccounts != null), [hist]);
  const histReward = useMemo(() => hist.filter((p) => p.rewardPool != null), [hist]);

  const axis = { fill: 'var(--text-secondary)', fontSize: isMobile ? 10 : 12 };
  const healthy = live?.workerSaturation != null && live.workerSaturation < 0.8 && (live.queueDepth ?? 0) < 100;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <main className="flex-1 w-full px-3 sm:px-6 lg:px-10 py-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="page-title text-[var(--text-primary)]">Network</h1>
          {live && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <span className={`h-2 w-2 rounded-full ${healthy ? 'bg-[var(--pos)]' : 'bg-[var(--neg)]'}`} />
              Sequencer {healthy ? 'healthy' : 'degraded'}
            </span>
          )}
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <HeroKpi
            label="Consensus Latency · median"
            loading={live == null}
            rawValue={live?.latencyMedianMs ?? 0}
            format={fmtMs}
            series={spark.latency}
            color="var(--pos)"
            sub={live?.latencyP99Ms != null ? `p99 ${live.latencyP99Ms.toFixed(2)} ms` : undefined}
          />
          <HeroKpi
            label="Rounds / sec"
            loading={live == null}
            rawValue={live?.roundsPerSec ?? 0}
            format={(n) => n.toFixed(0)}
            series={spark.rounds}
            color="var(--accent)"
            sub={live?.roundHeight != null ? `round ${fmtInt(live.roundHeight)}` : undefined}
          />
          <HeroKpi
            label="Active Accounts"
            loading={live == null}
            rawValue={live?.activeAccounts ?? 0}
            format={fmtInt}
            series={spark.active}
            color="var(--coin-1)"
            sub={live?.submissionsPerSec != null ? `${live.submissionsPerSec.toFixed(0)} submissions/s` : undefined}
          />
          <HeroKpi
            label="Reward Pool"
            loading={live == null}
            rawValue={(live?.rewardPool ?? 0) / 1e9}
            format={(n) => formatCompact(n)}
            series={spark.reward}
            color="var(--coin-2)"
            sub={live?.totalAccounts != null ? `${fmtInt(live.totalAccounts)} total accounts` : undefined}
          />
        </div>

        {/* Charts — each resizable (drag the bottom-right corner) with a timeline
            brush below to pick an exact window. The top two share a row and
            trade width; the reward pool spans full width. */}
        <div className="space-y-4">
          <ResizableChartRow storageKey="net-charts" defaultHeight={300}>
          {/* Consensus latency over time */}
          <TimelineChart
            title="Consensus Latency"
            full={histLatency}
            emptyLabel="Latency history builds as snapshots accumulate"
            yLabel="ms"
            legend={[{ label: 'Median', color: 'var(--pos)' }, { label: 'p99', color: 'var(--neg)' }]}
            sliderColor="var(--pos)"
            sliderKeys={['latencyMedianMs']}
          >
            {(data, fmtAxis) => (
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--pos)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--pos)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="timestamp" tickFormatter={fmtAxis} tick={axis} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} minTickGap={isMobile ? 40 : 60} />
                <YAxis tick={axis} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={isMobile ? 32 : 44} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }} labelFormatter={(t) => new Date(t as string).toLocaleString()} formatter={(v: number, n: string) => [`${Number(v).toFixed(2)} ms`, n === 'latencyMedianMs' ? 'Median' : 'p99']} />
                <Area type="monotone" dataKey="latencyP99Ms" stroke="var(--neg)" strokeWidth={1.5} fill="none" dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="latencyMedianMs" stroke="var(--pos)" strokeWidth={2} fill="url(#latGrad)" dot={false} isAnimationActive={false} />
              </AreaChart>
            )}
          </TimelineChart>

          {/* Account growth */}
          <TimelineChart
            title="Account Growth"
            full={histAccounts}
            emptyLabel="Account history builds as snapshots accumulate"
            yLabel="Accounts"
            legend={[{ label: 'Total', color: 'var(--role-content)' }, { label: 'Active', color: 'var(--pos)' }]}
            sliderColor="var(--role-content)"
            sliderKeys={['totalAccounts']}
          >
            {(data, fmtAxis) => (
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="totGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--role-content)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--role-content)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="timestamp" tickFormatter={fmtAxis} tick={axis} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} minTickGap={isMobile ? 40 : 60} />
                <YAxis tick={axis} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={isMobile ? 40 : 52} tickFormatter={(v) => formatCompact(Number(v))} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }} labelFormatter={(t) => new Date(t as string).toLocaleString()} formatter={(v: number, n: string) => [fmtInt(Number(v)), n === 'totalAccounts' ? 'Total' : 'Active']} />
                <Area type="monotone" dataKey="totalAccounts" stroke="var(--role-content)" strokeWidth={2} fill="url(#totGrad)" dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="activeAccounts" stroke="var(--pos)" strokeWidth={2} fill="none" dot={false} isAnimationActive={false} />
              </AreaChart>
            )}
          </TimelineChart>
          </ResizableChartRow>

          {/* Reward pool — full width, resizable on both axes */}
          <ResizableChart storageKey="net-reward" defaultHeight={300}>
            <TimelineChart
              title="Reward Pool"
              full={histReward}
              emptyLabel="Reward-pool history builds as snapshots accumulate"
              yLabel="Pool"
              sliderColor="var(--role-signal-info)"
              sliderKeys={['rewardPool']}
            >
              {(data, fmtAxis) => (
                <AreaChart data={data.map((p) => ({ ...p, poolUnits: p.rewardPool != null ? p.rewardPool / 1e9 : null }))}>
                  <defs>
                    <linearGradient id="poolGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--role-signal-info)" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="var(--role-signal-info)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="timestamp" tickFormatter={fmtAxis} tick={axis} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} minTickGap={isMobile ? 40 : 60} />
                  <YAxis tick={axis} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={isMobile ? 40 : 52} tickFormatter={(v) => formatCompact(Number(v))} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }} labelFormatter={(t) => new Date(t as string).toLocaleString()} formatter={(v: number) => [formatCompact(Number(v)), 'Reward Pool']} />
                  <Area type="monotone" dataKey="poolUnits" stroke="var(--role-signal-info)" strokeWidth={2} fill="url(#poolGrad)" dot={false} isAnimationActive={false} />
                </AreaChart>
              )}
            </TimelineChart>
          </ResizableChart>
        </div>
      </main>
    </div>
  );
}

// One time-series card with a timeline brush under it. The brush picks an index
// window of the full history; the chart re-renders on the sliced data. The card
// reads its body height from the `--chart-h` CSS variable, so it can be dropped
// straight into a ResizableChartRow (two-up, share width) or a ResizableChart
// (single, full-width) — matching the resize behaviour of the other pages.
// `children` is a render prop that draws the recharts chart for the given
// (sliced) data and axis formatter. `isDragging` is injected by ResizableChartRow.
function TimelineChart({
  title, full, emptyLabel, yLabel, legend, sliderColor, sliderKeys, sliderType = 'area', children, isDragging,
}: {
  title: string;
  full: PerformancePoint[];
  emptyLabel: string;
  yLabel: string;
  legend?: { label: string; color: string }[];
  sliderColor: string;
  sliderKeys: string[];
  sliderType?: 'area' | 'line';
  children: (data: PerformancePoint[], fmtAxis: (ts: string) => string) => React.ReactElement;
  isDragging?: boolean;
}) {
  const [range, setRange] = useState<[number, number]>([0, 100]);
  const sliced = useMemo(() => sliceByRange(full, range[0], range[1]), [full, range]);

  // Axis label: time when the *visible* window spans < ~36h, date otherwise.
  const spanHours = sliced.length >= 2
    ? (new Date(sliced[sliced.length - 1].timestamp).getTime() - new Date(sliced[0].timestamp).getTime()) / 3.6e6
    : 0;
  const fmtAxis = (ts: string) => {
    const d = new Date(ts);
    return spanHours < 36
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4 h-full flex flex-col">
      <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      <div className={`h-[var(--chart-h,300px)] transition-[filter] duration-150 ${isDragging ? 'blur-[1.5px]' : ''}`}>
        {full.length < 2 ? (
          <Empty label={emptyLabel} />
        ) : (
          <ChartFrame title={title} className="h-full" yLabel={yLabel} legend={legend}>
            <ResponsiveContainer width="100%" height="100%">
              {children(sliced, fmtAxis)}
            </ResponsiveContainer>
          </ChartFrame>
        )}
      </div>
      {full.length >= 2 && (
        <InteractiveRangeSlider
          data={full}
          chartType={sliderType}
          color={sliderColor}
          dataKeys={sliderKeys}
          rangeStart={range[0]}
          rangeEnd={range[1]}
          onRangeChange={(s, e) => setRange([s, e])}
        />
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-center text-sm text-[var(--text-tertiary)] px-4">
      {label}
    </div>
  );
}
