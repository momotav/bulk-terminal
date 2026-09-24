'use client';

// Network telemetry panel (home page, beside the Markets table).
//
// Live BULK sequencer performance from /api/analytics/performance: consensus
// latency, round throughput and order-submission rate, plus round height,
// active accounts and reward pool as context. A tabbed rolling area chart
// graphs the selected rate; polled every 3s and accumulated client-side.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { AnimatedNumber } from './AnimatedNumber';
import { analytics, cn, formatCompact, type PerformanceLive } from '@/lib/api';

type Metric = 'latency' | 'rounds' | 'subs';
const METRICS: { key: Metric; label: string; unit: string; color: string; pick: (p: PerformanceLive) => number }[] = [
  { key: 'latency', label: 'Latency', unit: 'ms', color: 'var(--pos)', pick: (p) => p.latencyMedianMs ?? 0 },
  { key: 'rounds', label: 'Rounds/s', unit: '/s', color: 'var(--accent)', pick: (p) => p.roundsPerSec ?? 0 },
  { key: 'subs', label: 'Orders/s', unit: '/s', color: 'var(--coin-1)', pick: (p) => p.submissionsPerSec ?? 0 },
];
const HISTORY = 60; // ~3 min at 3s cadence

const fmtRate = (n: number, unit: string): string => {
  if (unit === 'ms') return n.toFixed(2);
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
};

export function TelemetryPanel() {
  const [live, setLive] = useState<PerformanceLive | null>(null);
  const [metric, setMetric] = useState<Metric>('latency');
  const [hist, setHist] = useState<Record<Metric, number[]>>({ latency: [], rounds: [], subs: [] });

  useEffect(() => {
    let cancelled = false;
    const load = () => analytics.getPerformance().then((d) => {
      if (cancelled || !d) return;
      setLive(d);
      setHist((prev) => {
        const push = (arr: number[], v: number) => [...arr, v].slice(-HISTORY);
        return {
          latency: push(prev.latency, d.latencyMedianMs ?? 0),
          rounds: push(prev.rounds, d.roundsPerSec ?? 0),
          subs: push(prev.subs, d.submissionsPerSec ?? 0),
        };
      });
    }).catch(() => {});
    load();
    const id = window.setInterval(load, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const active = METRICS.find((m) => m.key === metric)!;
  const chartData = useMemo(() => hist[metric].map((v, i) => ({ i, v })), [hist, metric]);
  const healthy = live?.workerSaturation != null && live.workerSaturation < 0.8 && (live.queueDepth ?? 0) < 100;
  const value = live ? active.pick(live) : 0;

  return (
    <div className="glass-card flex h-full flex-col">
      {/* Header */}
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2">Network</h2>
          <p className="t-caption truncate">BULK sequencer · live performance</p>
        </div>
        <span
          title={live ? (healthy ? 'Sequencer healthy' : 'Sequencer degraded') : undefined}
          className={cn('h-2 w-2 rounded-full', live ? (healthy ? 'bg-[var(--pos)]' : 'bg-[var(--neg)]') : 'bg-[var(--role-line)]')}
        />
      </div>

      {/* Metric tabs */}
      <div className="flex items-center gap-1 px-4 pt-3">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
              metric === m.key ? 'bg-[var(--bg-secondary-20)] text-[var(--role-content)]' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Headline value */}
      <div className="px-4 pt-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[32px] font-bold font-sans leading-none tracking-tight tabular-nums text-[var(--role-content)]" style={{ color: active.color }}>
            <AnimatedNumber value={value} format={(n) => fmtRate(n, active.unit)} />
          </span>
          <span className="text-sm font-medium text-[var(--role-content-subtle)]">{active.unit}</span>
        </div>
        {metric === 'latency' && live?.latencyP99Ms != null && (
          <p className="mt-1 text-[11px] text-[var(--role-content-subtle)]">p99 {live.latencyP99Ms.toFixed(2)} ms · max {live.latencyMaxMs?.toFixed(1)} ms</p>
        )}
      </div>

      {/* Rolling chart */}
      <div className="min-h-0 flex-1 px-1 pb-1 pt-2">
        {chartData.length < 2 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-[var(--role-content-subtle)]">Sampling…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <defs>
                <linearGradient id="telGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={active.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={active.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Area type="monotone" dataKey="v" stroke={active.color} strokeWidth={2} fill="url(#telGrad)" isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Footer context stats */}
      <div className="grid grid-cols-3 gap-2 border-t border-[var(--role-line-subtle)] px-4 py-3 text-center">
        <Stat label="Round" value={live?.roundHeight != null ? formatCompact(live.roundHeight) : '—'} />
        <Stat label="Active" value={live?.activeAccounts != null ? live.activeAccounts.toLocaleString() : '—'} />
        <Stat label="Reward Pool" value={live?.rewardPool != null ? formatCompact(live.rewardPool / 1e9) : '—'} />
      </div>

      <Link href="/analytics/network" className="border-t border-[var(--role-line-subtle)] px-4 py-2 text-center text-[11px] font-medium text-[var(--role-content-subtle)] transition-colors hover:text-[var(--role-content)]">
        Full performance dashboard →
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-[var(--role-content)]">{value}</p>
    </div>
  );
}
