'use client';

import { useEffect, useState } from 'react';
import { Activity, Zap, Hash } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';

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
  const [data, setData] = useState<ThroughputData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchThroughput = async () => {
      try {
        const res = await fetch(`${API_URL}/api/explorer/throughput`);
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
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 animate-pulse"
          >
            <div className="h-4 w-20 bg-[var(--bg-secondary-20)] rounded mb-2" />
            <div className="h-8 w-24 bg-[var(--bg-secondary-20)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* TPS — transactions per second from the explorer block stream */}
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-bulk-green" />
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
            TPS
          </span>
        </div>
        <p className="text-2xl font-bold text-bulk-green tabular-nums">
          <AnimatedNumber value={data?.tps ?? 0} format={formatRate} />
        </p>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
          {data?.windowSeconds ?? 60}s avg
        </p>
      </div>

      {/* APS — actions per second. Actions are sub-transaction units
          (a single tx can contain many actions). On BULK this is a more
          meaningful "throughput" number than tx-count alone. */}
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4 text-yellow-400" />
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
            APS
          </span>
        </div>
        <p className="text-2xl font-bold text-yellow-400 tabular-nums">
          <AnimatedNumber value={data?.aps ?? 0} format={formatRate} />
        </p>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
          actions / sec
        </p>
      </div>

      {/* Current round + block time underneath */}
      <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Hash className="w-4 h-4 text-blue-400" />
          <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
            Round
          </span>
        </div>
        <p className="text-2xl font-bold text-blue-400 tabular-nums">
          <AnimatedNumber
            value={data?.latestRound ?? null}
            format={(n) => Math.round(n).toLocaleString()}
          />
        </p>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
          {formatBlockTime(data?.blockTimeMs ?? null)} block time
        </p>
      </div>
    </div>
  );
}
