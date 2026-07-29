'use client';

import { useEffect, useState } from 'react';
import { Trophy, Flame, Anchor, Activity } from 'lucide-react';
import { leaderboard, formatCompact, formatAddress, cn, type LeaderboardEntry } from '@/lib/api';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { useStore } from '@/store';
import Link from 'next/link';

type LeaderboardType = 'pnl' | 'liquidated' | 'whales' | 'active';

interface LeaderboardTableProps {
  type: LeaderboardType;
  limit?: number;
  showTimeframe?: boolean;
  // Drops the panel's own border so it can sit inside a bordered grid
  // and share hairlines with its neighbours. Used on the dashboard,
  // where panels sit flush against each other.
  flush?: boolean;
}

// `accent` is the raw palette value — it drives the icon chip, the row
// hover rail and the value column, so a panel reads as one color story
// instead of a headline in one hue and numbers in another.
const typeConfig = {
  pnl: {
    title: 'Top Traders',
    subtitle: 'Ranked by PnL',
    icon: Trophy,
    color: 'text-bulk-green',
    accent: 'var(--bids)',
    valueLabel: 'PnL',
    valuePrefix: '$',
  },
  liquidated: {
    title: 'Hall of Shame',
    subtitle: 'Most Liquidated',
    icon: Flame,
    color: 'text-bulk-red',
    accent: 'var(--asks)',
    valueLabel: 'Rekt',
    valuePrefix: '$',
  },
  whales: {
    title: 'Whale Watch',
    subtitle: 'Biggest Positions',
    icon: Anchor,
    color: 'text-bulk-blue',
    accent: 'var(--role-signal-info)',
    valueLabel: 'Notional',
    valuePrefix: '$',
  },
  active: {
    title: 'Most Active',
    subtitle: 'By Trade Count',
    icon: Activity,
    color: 'text-bulk-purple',
    accent: 'var(--role-signal-info)',
    valueLabel: 'Volume',
    valuePrefix: '$',
  },
};

export function LeaderboardTable({
  type,
  limit = 10,
  showTimeframe = true,
  flush = false,
}: LeaderboardTableProps) {
  const { network } = useCurrentNetwork();
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { timeframe, setTimeframe } = useStore();

  const config = typeConfig[type];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        let result: LeaderboardEntry[];
        switch (type) {
          case 'pnl':
            result = await leaderboard.getTopPnL(timeframe, limit);
            break;
          case 'liquidated':
            result = await leaderboard.getMostLiquidated(timeframe, limit);
            break;
          case 'whales':
            result = await leaderboard.getWhales(limit);
            break;
          case 'active':
            result = await leaderboard.getMostActive(timeframe, limit);
            break;
        }
        setData(result);
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [type, timeframe, limit, network]);

  // Podium ranks get a filled amber medallion off the existing --shade
  // ramp; everything below gets a hairline outline. Icons were doing two
  // jobs badly here (a crown and a medal read as different *kinds* of
  // thing, not as 1st and 2nd), so the number itself is the badge.
  const getRankBadge = (rank: number) => (
    <span
      className={cn(
        'rank-badge',
        rank === 1 && 'rank-badge-1',
        rank === 2 && 'rank-badge-2',
        rank === 3 && 'rank-badge-3',
        rank > 3 && 'rank-badge-rest'
      )}
      title={`Rank ${rank}`}
    >
      {rank}
    </span>
  );

  return (
    <div className={cn('glass-card h-full flex flex-col', flush && 'panel-flush')}>
      <div className="panel-header">
        <div className="flex items-center gap-2 min-w-0">
          <span className="panel-icon" style={{ color: config.accent }}>
            <config.icon className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className="panel-title t-h2 truncate">{config.title}</h2>
            <p className="t-caption truncate">{config.subtitle}</p>
          </div>
        </div>

        {showTimeframe && type !== 'whales' && (
          <div className="toggle-group shrink-0">
            {(['24h', '7d', '30d', 'all'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "toggle-btn",
                  timeframe === tf && "active"
                )}
              >
                {tf === 'all' ? 'All' : tf.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Column header. Anchors the right-aligned money column so the
          eye knows what it's scanning before it starts scanning. */}
      {!loading && data.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--role-line-subtle)] bg-[var(--role-background)]/40">
          <span className="table-header w-[1.375rem] text-center">#</span>
          <span className="table-header flex-1">Wallet</span>
          {/* Trades gets its own column once there is room for one. Below
              lg it collapses back under the wallet so nothing is lost. */}
          <span className="table-header hidden w-20 text-right lg:block">Trades</span>
          <span className="table-header w-24 text-right">{config.valueLabel}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="p-3 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse p-2">
                <div className="w-6 h-6 bg-[var(--bg-secondary-20)] rounded" />
                <div className="flex-1">
                  <div className="h-3 w-20 bg-[var(--bg-secondary-20)] rounded" />
                </div>
                <div className="h-4 w-16 bg-[var(--bg-secondary-20)] rounded" />
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <span
              className="panel-icon mb-3 !h-10 !w-10 opacity-40"
              style={{ color: config.accent }}
            >
              <config.icon className="w-5 h-5" strokeWidth={1.5} />
            </span>
            <p className="t-body text-[var(--role-content-muted)]">No data yet</p>
            <p className="t-caption mt-1">Rankings appear once activity is indexed.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-secondary)]">
            {data.map((entry, i) => (
              <Link
                key={entry.wallet_address}
                href={`/whales/${entry.wallet_address}`}
                prefetch={false}
                style={
                  {
                    '--row-accent': config.accent,
                    '--row-index': i,
                  } as React.CSSProperties
                }
                className="data-row animate-row-enter flex items-center gap-3 px-4 py-2.5"
              >
                {/* Rank */}
                {getRankBadge(entry.rank)}

                {/* Address */}
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs tracking-tight text-[var(--role-content)]">
                    {formatAddress(entry.wallet_address)}
                  </span>
                  {/* Mobile fallback for the trades column. */}
                  {entry.trades && (
                    <p className="t-caption tabular-nums lg:hidden">{entry.trades} trades</p>
                  )}
                </div>

                {/* Trades */}
                <p className="t-caption hidden w-20 shrink-0 text-right font-mono tabular-nums lg:block">
                  {entry.trades ? entry.trades.toLocaleString() : '-'}
                </p>

                {/* Value */}
                <p
                  className="w-24 shrink-0 text-right font-mono text-sm font-bold tabular-nums tracking-tight"
                  style={{ color: config.accent }}
                >
                  {config.valuePrefix}{formatCompact(entry.value)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>

      {data.length > 0 && (
        <div className="border-t border-[var(--border-color)] px-4 py-2">
          <Link
            href={`/leaderboard?type=${type}`}
            className="group inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]
                       transition-colors hover:text-[var(--text-primary)]"
          >
            View full leaderboard
            <span
              aria-hidden
              className="transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
