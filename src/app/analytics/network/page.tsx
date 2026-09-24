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
import { analytics, formatCompact, type PerformanceLive, type PerformancePoint } from '@/lib/api';
import { useIsMobile } from '@/hooks/useIsMobile';

const fmtMs = (n: number) => `${n.toFixed(2)} ms`;
const fmtInt = (n: number) => Math.round(n).toLocaleString();
// reward_pool_balance is a Solana lamport-scale integer; show it in whole units.
const fmtPool = (n: number) => `${formatCompact(n / 1e9)}`;

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
    return {
      latency: tail.map((p) => p.latencyMedianMs ?? 0).filter((v) => v > 0),
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

  // Axis label: show the time when the data spans < ~36h (so a single day of
  // hourly buckets reads "18:00, 19:00…" not "Sep 24, Sep 24…"); the date once
  // it spans multiple days.
  const spanHours = hist.length >= 2 ? (new Date(hist[hist.length - 1].timestamp).getTime() - new Date(hist[0].timestamp).getTime()) / 3.6e6 : 0;
  const fmtAxis = (ts: string) => {
    const d = new Date(ts);
    return spanHours < 36
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

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
            series={spark.latency}
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

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Consensus latency over time */}
          <div className="bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4 h-[360px] flex flex-col">
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">Consensus Latency</h3>
            <div className="flex-1 min-h-0">
              {histLatency.length < 2 ? (
                <Empty label="Latency history builds as snapshots accumulate" />
              ) : (
                <ChartFrame title="Consensus Latency" className="h-full" yLabel="ms" legend={[{ label: 'Median', color: 'var(--pos)' }, { label: 'p99', color: 'var(--neg)' }]}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={histLatency}>
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
                  </ResponsiveContainer>
                </ChartFrame>
              )}
            </div>
          </div>

          {/* Account growth */}
          <div className="bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4 h-[360px] flex flex-col">
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">Account Growth</h3>
            <div className="flex-1 min-h-0">
              {histAccounts.length < 2 ? (
                <Empty label="Account history builds as snapshots accumulate" />
              ) : (
                <ChartFrame title="Account Growth" className="h-full" yLabel="Accounts" legend={[{ label: 'Total', color: 'var(--role-content)' }, { label: 'Active', color: 'var(--pos)' }]}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={histAccounts}>
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
                  </ResponsiveContainer>
                </ChartFrame>
              )}
            </div>
          </div>

          {/* Reward pool */}
          <div className="bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4 h-[360px] flex flex-col lg:col-span-2">
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">Reward Pool</h3>
            <div className="flex-1 min-h-0">
              {histReward.length < 2 ? (
                <Empty label="Reward-pool history builds as snapshots accumulate" />
              ) : (
                <ChartFrame title="Reward Pool" className="h-full" yLabel="Pool">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={histReward.map((p) => ({ ...p, poolUnits: p.rewardPool != null ? p.rewardPool / 1e9 : null }))}>
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
                  </ResponsiveContainer>
                </ChartFrame>
              )}
            </div>
          </div>
        </div>
      </main>
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
