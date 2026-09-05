'use client';

// Network telemetry as a live chart panel, sitting beside the Markets
// table. Chain throughput (TPS / APS) is polled every 3s, accumulated into
// a rolling history, and drawn as a live area chart with a tab to switch
// which metric is graphed. Round and block time ride along as context
// stats in the footer.
//
// Colours come through inline `style` (a CSS property, so `var(--…)`
// resolves) rather than SVG presentation attributes — that keeps the chart
// on the active palette and theme without hard-coded hex.

import { useEffect, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { AnimatedNumber } from './AnimatedNumber';
import { cn, formatCompact } from '@/lib/api';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

interface ThroughputData {
  tps: number;
  aps: number;
  sampleCount: number;
  windowSeconds: number;
  latestRound: number | null;
  latestBlockhash: string | null;
  latestTimestampNs: number | null;
  blockTimeMs: number | null;
  status: 'live' | 'stale' | 'disconnected';
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';

const POLL_INTERVAL_MS = 3_000;
// ~3 minutes of history at a 3s cadence — enough to show shape, short
// enough that a burst still visibly bends the line.
const HISTORY_LENGTH = 60;

type Metric = 'tps' | 'aps';

function formatRate(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function formatBlockTime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '--';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Live area chart, drawn with recharts — the project's single chart
// library (already used across the analytics pages), so this adds no new
// dependency. recharts sets stroke/fill as SVG presentation attributes,
// which do NOT resolve `var(--…)`, so the palette colour is read from the
// document as a concrete hex and re-read whenever the palette or theme
// attribute changes.
function LiveChart({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--role-content-subtle)]">
        Collecting data…
      </div>
    );
  }

  const data = values.map((value, i) => ({ i, value }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
        <defs>
          <linearGradient id="telemetry-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Domain hugs the data so the line uses the full height. */}
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill="url(#telemetry-fill)"
          isAnimationActive={false}
          dot={false}
          activeDot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Reads a palette CSS custom property as a resolved hex and keeps it in
// sync when the active palette or theme changes on <html>.
function usePaletteColor(cssVar: string, fallback: string): string {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
      if (v) setColor(v);
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-palette'],
    });
    return () => obs.disconnect();
  }, [cssVar]);
  return color;
}

interface TelemetryPanelProps {
  flush?: boolean;
}

export function TelemetryPanel({ flush = false }: TelemetryPanelProps) {
  const { network } = useCurrentNetwork();
  const [data, setData] = useState<ThroughputData | null>(null);
  const [tpsHistory, setTpsHistory] = useState<number[]>([]);
  const [apsHistory, setApsHistory] = useState<number[]>([]);
  const [tab, setTab] = useState<Metric>('tps');
  const [loading, setLoading] = useState(true);

  // BULK is not running a mainnet explorer WS for mainnet's first ~30 days
  // (the load is too high), so there's no mainnet chain telemetry yet. The
  // explorer node still streams the TESTNET chain, but that isn't mainnet data,
  // so on mainnet we show a "coming soon" state rather than the testnet numbers.
  const pending = network === 'mainnet';

  useEffect(() => {
    if (pending) return; // don't poll / don't surface testnet numbers on mainnet
    let cancelled = false;
    // A network switch is a different chain — its history must not share a
    // line with the previous one.
    setTpsHistory([]);
    setApsHistory([]);

    const fetchThroughput = async () => {
      try {
        const res = await fetch(`${API_URL}${withNetwork('/api/explorer/throughput')}`);
        if (!res.ok) return;
        const json = (await res.json()) as ThroughputData;
        if (cancelled) return;
        setData(json);
        setLoading(false);
        if (Number.isFinite(json.tps)) {
          setTpsHistory((prev) => [...prev, json.tps].slice(-HISTORY_LENGTH));
        }
        if (Number.isFinite(json.aps)) {
          setApsHistory((prev) => [...prev, json.aps].slice(-HISTORY_LENGTH));
        }
      } catch {
        // Silent — telemetry is an enhancement, not a blocker.
      }
    };

    fetchThroughput();
    const tick = window.setInterval(fetchThroughput, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [network, pending]);

  const live = !pending && data?.status === 'live';
  const down = !pending && data?.status === 'disconnected';
  const statusColor = pending
    ? 'var(--accent)'
    : live ? 'var(--bids)' : data?.status === 'stale' ? 'var(--accent)' : 'var(--asks)';
  const statusLabel = pending ? 'Soon' : live ? 'Live' : data?.status === 'stale' ? 'Stale' : 'Down';

  // The throughput line reads as "live pulse", so it takes the same
  // semantic-positive colour as the live-status dot (--pos / --bids),
  // resolved to a hex for recharts and kept in sync with palette/theme.
  const chartColor = usePaletteColor('--pos', '#21C07A');

  const metrics: Record<Metric, { label: string; value: number; hist: number[]; sub: string }> = {
    tps: {
      label: 'TPS',
      value: data?.tps ?? 0,
      hist: tpsHistory,
      sub: `${data?.windowSeconds ?? 60}s average`,
    },
    aps: {
      label: 'APS',
      value: data?.aps ?? 0,
      hist: apsHistory,
      sub: 'actions / second',
    },
  };
  const m = metrics[tab];

  return (
    <div className={cn('glass-card flex h-full flex-col', flush && 'panel-flush')}>
      {/* Header — title + live status. */}
      <div className="panel-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="panel-title t-h2 truncate">Network</h2>
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              {live && (
                <span
                  className="live-halo absolute inline-flex h-full w-full rounded-full"
                  style={{ backgroundColor: statusColor }}
                />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${live ? 'live-core' : ''}`}
                style={{
                  backgroundColor: statusColor,
                  boxShadow: `0 0 6px color-mix(in srgb, ${statusColor} 60%, transparent)`,
                }}
              />
            </span>
            <span className="text-[11px] font-medium" style={{ color: statusColor }}>
              {statusLabel}
            </span>
          </span>
        </div>

        {/* Metric tabs. */}
        <div className="toggle-group shrink-0">
          {(['tps', 'aps'] as Metric[]).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn('toggle-btn', tab === k && 'active')}
            >
              {metrics[k].label}
            </button>
          ))}
        </div>
      </div>

      {/* Current value of the selected metric. */}
      <div className="px-4 pt-3">
        <p className="font-mono text-[26px] font-bold leading-none tracking-tight tabular-nums text-[var(--role-content)]">
          {pending || loading || down ? '--' : <AnimatedNumber value={m.value} format={formatRate} />}
          <span className="ml-1.5 text-[11px] font-medium text-[var(--role-content-subtle)]">
            {m.label}
          </span>
        </p>
        <p className="mt-1 text-[11px] text-[var(--role-content-subtle)]">{pending ? 'mainnet telemetry - coming soon' : down ? 'feed unavailable' : m.sub}</p>
      </div>

      {/* Live chart, filling the remaining height. When the upstream feed is
          down there's nothing to plot — say so rather than showing a flat
          zero line that reads as broken. */}
      <div className="min-h-0 flex-1 px-1 pb-1 pt-3">
        {pending ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-4 text-center">
            <p className="text-[11px] font-medium text-[var(--role-content-muted)]">Mainnet network telemetry</p>
            <p className="text-[10px] text-[var(--role-content-subtle)]">Launches with BULK&apos;s mainnet explorer (~30 days)</p>
          </div>
        ) : down ? (
          <div className="flex h-full w-full items-center justify-center px-4 text-center text-[11px] text-[var(--role-content-subtle)]">
            Live network feed unavailable
          </div>
        ) : (
          <LiveChart values={m.hist} color={chartColor} />
        )}
      </div>

      {/* Context stats — the other telemetry that doesn't chart well. */}
      <div className="flex divide-x divide-[var(--role-line-subtle)] border-t border-[var(--role-line)]">
        <div className="flex-1 px-4 py-2.5">
          <p className="text-[10px] text-[var(--role-content-subtle)]">Round</p>
          <p className="mt-0.5 font-mono text-xs font-medium tabular-nums text-[var(--role-content)]">
            {data?.latestRound != null ? formatCompact(data.latestRound) : '--'}
          </p>
        </div>
        <div className="flex-1 px-4 py-2.5">
          <p className="text-[10px] text-[var(--role-content-subtle)]">Block time</p>
          <p className="mt-0.5 font-mono text-xs font-medium tabular-nums text-[var(--role-content)]">
            {formatBlockTime(data?.blockTimeMs)}
          </p>
        </div>
      </div>
    </div>
  );
}
