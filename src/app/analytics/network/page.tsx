'use client';

// Analytics · Network — BULK sequencer performance & protocol health.
//
// Powered by BULK's executor /metrics endpoint (via our /performance and
// /performance-history routes): consensus latency, round throughput, order
// submissions, active/total accounts, reward pool, and node health. The live
// figures poll every few seconds; the trend charts come from the hourly
// snapshots we record.
//
// Layout: one live strip (number first, its trend underneath, never behind it),
// then one small chart per measure, so measures of very different size (17K
// total accounts vs 1.3K active) never share an axis.

import { useEffect, useMemo, useState } from 'react';
import { analytics, cn, formatCompact, type PerformanceLive, type PerformancePoint } from '@/lib/api';
import { SeriesChart, Legend, type Series } from '@/components/charts/SeriesChart';

const RANGES = [[24, '24H'], [168, '7D'], [720, '30D']] as const;
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const ms = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(2)} ms`);

/** The round height, counting up live between polls at the current rate. */
function RoundTicker({ height, rate, at }: { height: number | null; rate: number | null; at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let raf = 0; let last = 0;
    const tick = (t: number) => { if (t - last > 60) { last = t; setNow(Date.now()); } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (height == null) return null;
  // Never run more than 10s ahead of the last real figure.
  return <>round {fmtInt(Math.floor(height + (rate ?? 0) * Math.min(10, Math.max(0, (now - at) / 1000))))}</>;
}

/** Number first, unit small beside it, one line of context. */
function Kpi({ label, value, unit, sub, loading }: { label: string; value: string; unit?: string; sub?: React.ReactNode; loading: boolean }) {
  return (
    <div className="min-w-0 py-1">
      <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{label}</div>
      {loading ? <div className="mt-2 h-8 w-24 animate-pulse rounded bg-[var(--bg-muted)]" /> : (
        <div className="mt-1.5 flex items-baseline gap-1 tabular-nums">
          <span className="text-[30px] font-medium leading-none text-[var(--text-primary)]">{value}</span>
          {unit && <span className="text-[13px] text-[var(--text-tertiary)]">{unit}</span>}
        </div>
      )}
      <div className="mt-2 truncate text-[12px] tabular-nums text-[var(--text-secondary)]">{sub}</div>
    </div>
  );
}

/** One measure: current value, change over the range, and its chart. */
function MetricCard({ title, value, change, times, series, format, animKey, legend, className, zeroLine }: {
  title: string; value: string; change?: { text: string; tone?: string } | null;
  times: number[]; series: Series[]; format: (v: number) => string; animKey: string; legend?: boolean; className?: string;
  /** Start the axis at 0, so tiny wobbles on a steady rate don't look like swings. */
  zeroLine?: boolean;
}) {
  return (
    <div className={cn('glass-card p-4 md:p-5', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">{title}</div>
          <div className="mt-0.5 text-[22px] font-medium leading-tight tabular-nums text-[var(--text-primary)]">{value}</div>
        </div>
        {change && <span className="shrink-0 pt-1 text-[12px] tabular-nums" style={{ color: change.tone ?? 'var(--text-tertiary)' }}>{change.text}</span>}
      </div>
      <SeriesChart height={170} times={times} series={series} format={format} animKey={animKey} zeroLine={zeroLine} emptyText="History builds as snapshots accumulate." />
      {legend && <div className="mt-2"><Legend series={series} /></div>}
    </div>
  );
}

export default function NetworkPage() {
  const [live, setLive] = useState<PerformanceLive | null>(null);
  const [liveAt, setLiveAt] = useState(0);
  const [hours, setHours] = useState<number>(168);
  const [hist, setHist] = useState<PerformancePoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadLive = () => analytics.getPerformance().then((d) => {
      if (cancelled || !d) return;
      setLive(d); setLiveAt(Date.now());
    });
    loadLive();
    const a = window.setInterval(loadLive, 5000);
    return () => { cancelled = true; window.clearInterval(a); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = () => analytics.getPerformanceHistory(hours).then((d) => { if (!cancelled) setHist(d); });
    load(); const b = window.setInterval(load, 60_000);
    return () => { cancelled = true; window.clearInterval(b); };
  }, [hours]);

  const h = hist ?? [];
  const times = h.map((p) => new Date(p.timestamp).getTime());

  // Rounds/sec isn't stored: derive it from the round-height delta between
  // snapshots. Gaps (restarts, missing snapshots) give nonsense, so drop points
  // far from the typical rate instead of plotting a dive to zero.
  const rounds = useMemo(() => {
    const raw: (number | null)[] = h.map((p, i) => {
      const a = h[i - 1];
      if (!a || a.roundHeight == null || p.roundHeight == null) return null;
      const dt = (new Date(p.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
      const r = dt > 0 ? (p.roundHeight - a.roundHeight) / dt : NaN;
      return Number.isFinite(r) && r > 0 ? r : null;
    });
    // The newest bucket is a partial hour (its average round height lags), so its rate is wrong.
    if (raw.length) raw[raw.length - 1] = null;
    const ok = raw.filter((v): v is number => v !== null).sort((x, y) => x - y);
    const med = ok[Math.floor(ok.length / 2)] ?? 0;
    return raw.map((v) => (v !== null && med > 0 && v > med * 0.5 && v < med * 1.5 ? v : null));
  }, [hist]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (f: (p: PerformancePoint) => number | null) => h.map(f);
  const lat = pick((p) => p.latencyMedianMs), p99 = pick((p) => p.latencyP99Ms);
  const active = pick((p) => p.activeAccounts), total = pick((p) => p.totalAccounts);
  const pool = pick((p) => (p.rewardPool != null ? p.rewardPool / 1e9 : null));

  /** First→last change over the visible range. */
  const delta = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x !== null && x > 0);
    return v.length >= 2 ? { first: v[0], last: v[v.length - 1] } : null;
  };
  const tot = delta(total), pl = delta(pool), ac = delta(active);
  const label = RANGES.find(([r]) => r === hours)?.[1];
  const loading = live == null;

  return (
    <div className="w-full space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="page-title text-[var(--text-primary)]">Network</h1>
          <p className="mt-1 text-[14px] text-[var(--text-secondary)]">How BULK’s sequencer is running: consensus speed, throughput, accounts and the reward pool.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="toggle-group">{RANGES.map(([r, l]) => <button key={r} type="button" onClick={() => setHours(r)} className={cn('toggle-btn', hours === r && 'active')}>{l}</button>)}</div>
        </div>
      </div>

      {/* live strip: no boxes, just numbers between hairlines */}
      <div className="grid grid-cols-2 gap-y-6 border-y border-[var(--border-color)] py-5 md:grid-cols-3 xl:grid-cols-6 [&>*]:px-5 xl:[&>*:not(:first-child)]:border-l xl:[&>*]:border-[var(--border-color)] max-xl:[&>*:nth-child(even)]:border-l max-xl:[&>*]:border-[var(--border-color)] md:max-xl:[&>*:nth-child(even)]:border-l-0 md:max-xl:[&>*:not(:nth-child(3n+1))]:border-l">
        <Kpi label="Consensus latency" loading={loading} value={live?.latencyMedianMs != null ? live.latencyMedianMs.toFixed(2) : '—'} unit="ms"
          sub={live?.latencyP99Ms != null ? `p99 ${live.latencyP99Ms.toFixed(2)} ms` : undefined} />
        <Kpi label="Rounds" loading={loading} value={live?.roundsPerSec != null ? live.roundsPerSec.toFixed(0) : '—'} unit="/ sec"
          sub={<span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" /><RoundTicker height={live?.roundHeight ?? null} rate={live?.roundsPerSec ?? null} at={liveAt} /></span>} />
        <Kpi label="Submissions" loading={loading} value={live?.submissionsPerSec != null ? live.submissionsPerSec.toFixed(0) : '—'} unit="/ sec"
          sub={live?.submissionsTotal != null ? `${formatCompact(live.submissionsTotal)} all time` : undefined} />
        <Kpi label="Active accounts" loading={loading} value={live?.activeAccounts != null ? fmtInt(live.activeAccounts) : '—'}
          sub={live?.activeAccounts != null && live.totalAccounts ? `${((live.activeAccounts / live.totalAccounts) * 100).toFixed(1)}% of all accounts` : undefined} />
        <Kpi label="Total accounts" loading={loading} value={live?.totalAccounts != null ? fmtInt(live.totalAccounts) : '—'}
          sub={tot ? `+${fmtInt(tot.last - tot.first)} in ${label}` : undefined} />
        <Kpi label="Reward pool" loading={loading} value={live?.rewardPool != null ? formatCompact(live.rewardPool / 1e9) : '—'}
          sub={pl ? `+${formatCompact(pl.last - pl.first)} in ${label}` : undefined} />
      </div>

      {hist === null ? <div className="h-[520px] animate-pulse rounded-2xl bg-[var(--bg-muted)]" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <MetricCard title="Consensus latency"
            value={ms(live?.latencyMedianMs)} change={live?.latencyP99Ms != null ? { text: `p99 ${ms(live.latencyP99Ms)}` } : null}
            times={times} animKey={`lat-${hours}`} legend format={(v) => `${v.toFixed(1)} ms`}
            series={[{ key: 'm', label: 'Median', color: 'var(--accent)', values: lat }, { key: 'p', label: 'p99', color: 'var(--text-tertiary)', values: p99, dashed: true }]} />
          <MetricCard title="Rounds per second"
            value={live?.roundsPerSec != null ? live.roundsPerSec.toFixed(0) : '—'} change={live?.roundHeight != null ? { text: `round ${fmtInt(live.roundHeight)}` } : null}
            times={times} animKey={`rps-${hours}`} format={(v) => v.toFixed(0)} zeroLine
            series={[{ key: 'r', label: 'Rounds / sec', color: 'var(--accent)', values: rounds }]} />
          <MetricCard title="Active accounts"
            value={live?.activeAccounts != null ? fmtInt(live.activeAccounts) : '—'}
            change={ac ? { text: `${ac.last >= ac.first ? '+' : '−'}${fmtInt(Math.abs(ac.last - ac.first))} in ${label}` } : null}
            times={times} animKey={`act-${hours}`} format={(v) => fmtInt(v)}
            series={[{ key: 'a', label: 'Active', color: 'var(--accent)', values: active }]} />
          <MetricCard title="Total accounts"
            value={live?.totalAccounts != null ? fmtInt(live.totalAccounts) : '—'}
            change={tot ? { text: `+${fmtInt(tot.last - tot.first)} in ${label}` } : null}
            times={times} animKey={`tot-${hours}`} format={(v) => formatCompact(v)}
            series={[{ key: 't', label: 'Total', color: 'var(--accent)', values: total }]} />
          <MetricCard title="Reward pool"
            value={live?.rewardPool != null ? formatCompact(live.rewardPool / 1e9) : '—'}
            change={pl ? { text: `+${formatCompact(pl.last - pl.first)} in ${label}` } : null}
            times={times} animKey={`pool-${hours}`} format={(v) => v.toFixed(2)} className="md:col-span-2"
            series={[{ key: 'p', label: 'Reward pool', color: 'var(--accent)', values: pool }]} />
        </div>
      )}
    </div>
  );
}
