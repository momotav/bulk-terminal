'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Crown, Medal, Trophy, ExternalLink } from 'lucide-react';
import {
  leaderboard,
  formatCompact,
  formatAddress,
  cn,
  type BulkLeaderboardWindow,
  type BulkLeaderboardMetric,
  type BulkLeaderboardRow,
} from '@/lib/api';

// ----------------------------------------------------------------------------
// BulkLeaderboardTable — official tournament leaderboard sourced from BULK's
// indexer. Distinct from LeaderboardTable, which is our DB-backed views
// (most-liquidated, whales, most-active). The numbers in this table match
// bulk.trade's own UI exactly, which is critical for tournament viewers
// who flick between the two sites.
//
// Per the BULK dev: window=24h actually tracks the last 12h of trades
// (indexer-side limitation). We keep the label as "24H" so users see the
// same wording bulk.trade uses; the help icon mentions the 12h reality.
// ----------------------------------------------------------------------------

const WINDOWS: { id: BulkLeaderboardWindow; label: string }[] = [
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'all', label: 'All' },
];

const METRICS: { id: BulkLeaderboardMetric; label: string; description: string }[] = [
  // Order matches what we'd want a streamer to flick through. Cashflow ROI
  // first because it's the BULK default and the metric the platform team
  // uses for tournament rankings.
  {
    id: 'cashflow_adjusted_roi',
    label: 'Cashflow ROI',
    description: "BULK's primary skill metric — adjusts for capital deployed",
  },
  {
    id: 'realized_pnl',
    label: 'Realized PnL',
    description: 'Closed-position profit and loss',
  },
  {
    id: 'volume',
    label: 'Volume',
    description: 'Total notional traded',
  },
  {
    id: 'win_rate',
    label: 'Win Rate',
    description: 'Fraction of trades closed in profit',
  },
];

// Pull the right metric value off a row. The BULK indexer always returns
// every metric on every row; we just pick which one to display in the
// "rank value" column based on the selected sort metric.
function getMetricValue(row: BulkLeaderboardRow, metric: BulkLeaderboardMetric): number | null {
  switch (metric) {
    case 'cashflow_adjusted_roi':
      return row.cashflow_adjusted_roi;
    case 'realized_pnl':
      return row.realized_pnl;
    case 'net_realized_pnl':
      return row.net_realized_pnl;
    case 'volume':
      return row.volume;
    case 'roi':
      return row.roi;
    case 'net_realized_roi':
      return row.net_realized_roi;
    case 'win_rate':
      return row.win_rate;
  }
}

// Format the metric value appropriately. ROI metrics are fractions (0.0203
// = 2.03%); pnl/volume are dollars; win rate is a 0-1 fraction shown as %.
function formatMetricValue(value: number | null, metric: BulkLeaderboardMetric): string {
  if (value === null || value === undefined) return '—';
  switch (metric) {
    case 'cashflow_adjusted_roi':
    case 'roi':
    case 'net_realized_roi':
      return `${(value * 100).toFixed(2)}%`;
    case 'win_rate':
      return `${(value * 100).toFixed(1)}%`;
    case 'realized_pnl':
    case 'net_realized_pnl':
      return `${value >= 0 ? '+' : ''}$${formatCompact(Math.abs(value))}`;
    case 'volume':
      return `$${formatCompact(value)}`;
  }
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Crown className="w-4 h-4 text-bulk-orange" />;
  if (rank === 2) return <Medal className="w-4 h-4 text-[var(--text-secondary)]" />;
  if (rank === 3) return <Medal className="w-4 h-4 text-bulk-orange/70" />;
  return <span className="text-[var(--text-secondary)] font-mono text-xs">#{rank}</span>;
}

interface BulkLeaderboardTableProps {
  /** How many rows to show. Defaults to 50. The indexer caps at 100/page. */
  limit?: number;
  /** Whether to show the metric dropdown. Sometimes we want to lock to a
   *  specific metric (e.g. always-cashflow-ROI on a tournament page). */
  allowMetricChange?: boolean;
}

export function BulkLeaderboardTable({
  limit = 50,
  allowMetricChange = true,
}: BulkLeaderboardTableProps) {
  const [window, setWindow] = useState<BulkLeaderboardWindow>('24h');
  const [metric, setMetric] = useState<BulkLeaderboardMetric>('cashflow_adjusted_roi');
  const [rows, setRows] = useState<BulkLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Fetch on mount and whenever window/metric change. The backend caches
  // for 60s, so window-flicking on a page that's been open a while will
  // be near-instant after the first fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    leaderboard
      .getBulkLeaderboard({ window, metric, pageSize: limit })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows || []);
        // The indexer stamps each row with updated_at; they all share the
        // same timestamp within a page, so we just take row 0's stamp.
        setUpdatedAt(res.rows?.[0]?.updated_at || null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to fetch BULK leaderboard:', err);
        setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [window, metric, limit]);

  const activeMetricLabel = METRICS.find((m) => m.id === metric)?.label || metric;

  return (
    <div className="glass-card h-full flex flex-col">
      {/* Header — title, metric picker, window picker */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[var(--border-color)] flex-wrap">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-bulk-green" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Top Traders</h2>
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mt-0.5">
              Source: BULK indexer
              {updatedAt && (
                <span className="ml-1.5 normal-case tracking-normal text-[var(--text-tertiary)]">
                  · {formatRelativeTime(updatedAt)}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Metric picker (when allowed) — small native select to keep the
              JS bundle light. The order in METRICS controls dropdown order. */}
          {allowMetricChange && (
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as BulkLeaderboardMetric)}
              className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] cursor-pointer"
              aria-label="Leaderboard metric"
            >
              {METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}

          {/* Window pill group — same visual language as our other toggles */}
          <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.id}
                onClick={() => setWindow(w.id)}
                className={cn(
                  'px-2 py-1 text-[11px] font-medium rounded transition-colors',
                  window === w.id
                    ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-[var(--text-tertiary)] text-sm">
            Loading leaderboard…
          </div>
        ) : error ? (
          <div className="p-8 text-center text-[var(--text-tertiary)] text-sm">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-tertiary)] text-sm">
            No data for this window.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {rows.map((row) => {
              const metricValue = getMetricValue(row, metric);
              const isProfit =
                metric === 'realized_pnl' || metric === 'net_realized_pnl'
                  ? (metricValue ?? 0) >= 0
                  : true;

              return (
                <Link
                  key={row.wallet}
                  href={`/whales/${row.wallet}`}
                  prefetch={false}
                  className="grid grid-cols-[40px_1fr_auto_auto] gap-3 items-center px-4 py-2.5 hover:bg-[var(--bg-secondary-20)] transition-colors group"
                >
                  {/* Rank */}
                  <div className="flex items-center justify-center">
                    {getRankIcon(row.rank)}
                  </div>

                  {/* Wallet — short address + secondary stats below */}
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-[var(--text-primary)] truncate group-hover:underline underline-offset-2">
                      {formatAddress(row.wallet)}
                    </p>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      {row.closed_count} closed · {(row.win_rate * 100).toFixed(0)}% win rate
                    </p>
                  </div>

                  {/* Volume — context number, smaller */}
                  <div className="text-right hidden sm:block">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                      Volume
                    </p>
                    <p className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                      ${formatCompact(row.volume)}
                    </p>
                  </div>

                  {/* The big metric — colored by profit sign for PnL metrics */}
                  <div className="text-right">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
                      {activeMetricLabel}
                    </p>
                    <p
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        metric === 'realized_pnl' || metric === 'net_realized_pnl'
                          ? isProfit
                            ? 'text-bulk-green'
                            : 'text-bulk-red'
                          : 'text-[var(--text-primary)]'
                      )}
                    >
                      {formatMetricValue(metricValue, metric)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer — link to bulk.trade for cross-checking */}
      <div className="px-4 py-2.5 border-t border-[var(--border-color)] text-[10px] text-[var(--text-tertiary)] flex items-center justify-between">
        <span>
          {window === '24h' && '24h window tracks last 12h of trades · '}
          Match official BULK rankings
        </span>
        <a
          href="https://bulk.trade"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors"
        >
          bulk.trade <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

// Relative-time helper. Used for the "updated 2m ago" label in the header.
// Kept inline rather than reaching for a library — this is the only place
// we need it.
function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 30) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
