'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import {
  leaderboard,
  cn,
  type BulkLeaderboardRankResponse,
  type BulkLeaderboardWindow,
  type BulkLeaderboardMetric,
} from '@/lib/api';

interface Props {
  address: string;
  /** Window for ranking. Defaults to '24h' — short-term rank is the most
   *  meaningful for "is this whale active right now". */
  window?: BulkLeaderboardWindow;
  /** Metric for ranking. Defaults to cashflow_adjusted_roi which is the
   *  same default the dashboard's Top Traders uses, so the rank a user
   *  sees here matches what they'd see on the leaderboard. */
  metric?: BulkLeaderboardMetric;
}

const METRIC_LABELS: Record<BulkLeaderboardMetric, string> = {
  cashflow_adjusted_roi: 'Cashflow ROI',
  realized_pnl: 'Realized PnL',
  net_realized_pnl: 'Net PnL',
  volume: 'Volume',
  roi: 'ROI',
  net_realized_roi: 'Net ROI',
  win_rate: 'Win Rate',
};

const WINDOW_LABELS: Record<BulkLeaderboardWindow, string> = {
  '24h': '12H',  // BULK indexer's "24h" window is actually rolling 12h per their docs
  '7d': '7D',
  '30d': '30D',
  'all': 'All',
};

/**
 * Shows the wallet's rank on the BULK indexer leaderboard.
 *
 * - Renders nothing while loading or if the wallet isn't ranked (top
 *   ~2000 only — past that, rank is meaningless and we'd rather show
 *   nothing than confuse with "rank #4731").
 * - When found, renders a clickable pill that links to the full
 *   leaderboard page with the window+metric pre-selected.
 * - Auxiliary info — failure to load shouldn't block the rest of the
 *   wallet page, so we swallow errors silently.
 */
export function BulkRankBadge({
  address,
  window = '24h',
  metric = 'cashflow_adjusted_roi',
}: Props) {
  const [data, setData] = useState<BulkLeaderboardRankResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    leaderboard
      .getBulkRank(address, { window, metric })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, window, metric]);

  // Don't render anything while loading or if wallet isn't ranked.
  // No skeleton — this is auxiliary info, not load-blocking.
  if (loading || !data || !data.found) return null;

  const rank = data.rank;
  const total = data.total;

  // Color tier by rank — top 10 gold, top 100 green, top 1000 muted-green,
  // everything else neutral. Subtle differentiation that rewards top
  // performers visually without making rank #25000 feel like a failure.
  const tier =
    rank <= 10
      ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
      : rank <= 100
      ? 'text-bulk-green bg-bulk-green/10 border-bulk-green/30'
      : rank <= 1000
      ? 'text-bulk-green/70 bg-bulk-green/5 border-bulk-green/20'
      : 'text-[var(--text-secondary)] bg-[var(--bg-secondary-20)] border-[var(--border-color)]';

  // "of N traders" text only shown when we have a real total (the
  // legacy paginated endpoint provided this; the new direct-lookup
  // endpoint doesn't, so we show just the rank number in that case).
  const totalFmt =
    total > 0 ? (total >= 1000 ? `${(total / 1000).toFixed(1)}K` : String(total)) : null;

  return (
    <Link
      href={`/leaderboard?window=${window}&metric=${metric}`}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80',
        tier
      )}
      title={
        totalFmt
          ? `Rank #${rank} of ${total} traders by ${METRIC_LABELS[metric]} (${WINDOW_LABELS[window]}). Click to view leaderboard.`
          : `Rank #${rank} by ${METRIC_LABELS[metric]} (${WINDOW_LABELS[window]}). Click to view leaderboard.`
      }
    >
      <Trophy className="w-3.5 h-3.5" />
      <span className="tabular-nums font-semibold">#{rank}</span>
      <span className="text-[var(--text-tertiary)] font-normal">
        {totalFmt ? `of ${totalFmt} · ` : ''}{METRIC_LABELS[metric]}
      </span>
    </Link>
  );
}
