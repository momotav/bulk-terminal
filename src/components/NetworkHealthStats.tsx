'use client';

import { useEffect, useState } from 'react';
import { Activity, Zap, Hash } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

// Mirror of the backend's `getThroughput()` response shape. Kept inline
// rather than imported from a shared types module since this is the
// only consumer right now. If the explorer feature grows we can extract.
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
  process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

// Poll cadence. Faster than the trading stats (which poll every 30s)
// because TPS/APS feel "alive" when they refresh quickly — these are
// always-changing numbers, not slow-moving aggregates. Backend reads
// are free (in-memory), so we don't worry about hammering it.
const POLL_INTERVAL_MS = 3_000;

function formatRate(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function formatRound(n: number | null): string {
  if (n === null) return '--';
  // Show full number with thousand separators. Rounds are large
  // (millions) and the visual scale conveys "this chain is busy."
  return n.toLocaleString();
}

function formatBlockTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function NetworkHealthStats() {
  const { network } = useCurrentNetwork();
  const [data, setData] = useState<ThroughputData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchThroughput = async () => {
      try {
        const res = await fetch(`${API_URL}${withNetwork("/api/explorer/throughput")}`);
        if (!res.ok) return;
        const json = (await res.json()) as ThroughputData;
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch {
        // Silent fail — explorer is an enhancement, not a blocker.
        // If the backend route is down we just keep showing the last
        // known data (or the loading skeleton on first paint).
      }
    };

    fetchThroughput();
    const tick = window.setInterval(fetchThroughput, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [network]);

  if (loading) {
    return (
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg px-4 py-3 animate-pulse">
        <div className="h-5 w-full bg-[var(--bg-secondary-20)] rounded" />
      </div>
    );
  }

  // A trading terminal has a status bar, not three more big boxes. The
  // chain-throughput numbers (TPS / APS / round / block time) collapse
  // into one compact horizontal strip with a live-status dot — it reads
  // as "the exchange's pulse" rather than competing with the headline
  // trading stats above it.
  const live = data?.status === 'live';
  const statusColor = live ? 'var(--bids)' : data?.status === 'stale' ? 'var(--accent)' : 'var(--asks)';
  const items = [
    { icon: Activity, label: 'TPS', value: formatRate(data?.tps ?? 0), color: 'var(--bids)', sub: `${data?.windowSeconds ?? 60}s avg` },
    { icon: Zap, label: 'APS', value: formatRate(data?.aps ?? 0), color: '#facc15', sub: 'actions/sec' },
    { icon: Hash, label: 'Round', value: formatRound(data?.latestRound ?? null), color: '#60a5fa', sub: `${formatBlockTime(data?.blockTimeMs ?? null)} blocks` },
  ];

  return (
    <div className="flex items-stretch bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg overflow-hidden">
      {/* Live-status indicator at the head of the strip. */}
      <div className="flex items-center gap-2 px-4 border-r border-[var(--border-color)]">
        <span className="relative flex h-2 w-2">
          {live && (
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
              style={{ backgroundColor: statusColor }}
            />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: statusColor }} />
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[var(--text-secondary)]">
          {live ? 'Live' : data?.status === 'stale' ? 'Stale' : 'Down'}
        </span>
      </div>
      {/* Throughput items, evenly distributed. */}
      <div className="flex flex-1 divide-x divide-[var(--border-color)]">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="flex-1 flex items-center gap-2.5 px-4 py-2.5 min-w-0">
              <Icon className="w-4 h-4 shrink-0" style={{ color: it.color }} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
                    {it.label}
                  </span>
                  <span className="text-base font-bold tabular-nums leading-none" style={{ color: it.color }}>
                    {it.label === 'Round' ? (
                      <AnimatedNumber value={data?.latestRound ?? null} format={(n) => Math.round(n).toLocaleString()} />
                    ) : it.label === 'TPS' ? (
                      <AnimatedNumber value={data?.tps ?? 0} format={formatRate} />
                    ) : (
                      <AnimatedNumber value={data?.aps ?? 0} format={formatRate} />
                    )}
                  </span>
                </div>
                <span className="text-[9px] text-[var(--text-tertiary)] truncate block">{it.sub}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
