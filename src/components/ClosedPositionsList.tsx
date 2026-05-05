'use client';

import { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Flame } from 'lucide-react';
import { wallet, formatNumber, formatCompact, cn, type ClosedPosition } from '@/lib/api';
import { formatDuration } from '@/lib/positionWalk';

// ----------------------------------------------------------------------------
// ClosedPositionsList
//
// Replaces the old "Recent Trades" panel that showed individual fills.
// This panel shows full open→close lifecycles — each row is one position
// the wallet committed to and saw through, with realized PnL.
//
// For traders, this is the meaningful view: not "I filled 0.25 BTC" but
// "I went long BTC at 81,208 and closed at 81,300 for +$92". One decision
// per row.
//
// Falls back gracefully:
//   - Loading: skeleton rows so the UI doesn't jump
//   - Empty: matches "no trades found" pattern from the old component
//   - Error: silent swallow + empty state (don't alarm users with red banners
//     for an inessential side panel)
// ----------------------------------------------------------------------------

interface Props {
  address: string;
  /** Optional symbol filter — used by the chart modal version. */
  symbol?: string;
  /** Max rows to fetch from the backend. Default 50. */
  limit?: number;
}

export function ClosedPositionsList({ address, symbol, limit = 50 }: Props) {
  const [positions, setPositions] = useState<ClosedPosition[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch on mount, refetch when address/symbol changes. We don't refresh
  // on a timer because closed positions don't update retroactively — once
  // a position is closed, its row is final. New rows appear when the user
  // closes new positions, which happens infrequently enough that a manual
  // page refresh covers it.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);

    wallet
      .getClosedPositions(address, { symbol, limit })
      .then((res) => {
        if (cancelled) return;
        setPositions(res.positions || []);
      })
      .catch(() => {
        if (cancelled) return;
        setPositions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, symbol, limit]);

  if (loading) {
    return (
      <div className="divide-y divide-[var(--border-color)]">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-4 animate-pulse">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-4 w-16 bg-[var(--bg-secondary)] rounded" />
              <div className="h-4 w-10 bg-[var(--bg-secondary)] rounded" />
            </div>
            <div className="h-3 w-full bg-[var(--bg-secondary)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!positions || positions.length === 0) {
    return (
      <div className="p-8 text-center text-[var(--text-tertiary)]">
        <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No closed positions yet</p>
        <p className="text-xs mt-1">
          Recent open→close trades will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border-color)]">
      {positions.map((p, i) => (
        <ClosedPositionRow key={`${p.symbol}-${p.closedAt}-${i}`} p={p} />
      ))}
    </div>
  );
}

// One row per closed position. Layout: side+symbol on the left, PnL on
// the right (color-coded). Below: entry → close prices + duration.
function ClosedPositionRow({ p }: { p: ClosedPosition }) {
  const isWin = p.realizedPnl >= 0;
  const isLong = p.side === 'long';
  // PnL percent against notional at open. Falls back to 0 if size or
  // openPrice is somehow missing (defensive — should never happen with
  // real BULK data).
  const notionalAtOpen = p.size * p.openPrice;
  const pnlPercent = notionalAtOpen > 0
    ? (p.realizedPnl / notionalAtOpen) * 100
    : 0;
  // Price move percent — useful for context separate from leveraged PnL.
  const priceMovePercent = p.openPrice > 0
    ? ((p.closePrice - p.openPrice) / p.openPrice) * 100 * (isLong ? 1 : -1)
    : 0;
  const duration = p.closedAt - p.openedAt;

  return (
    <div className="p-4 hover:bg-[var(--bg-secondary-20)]/30 transition-colors">
      {/* Header row: side badge + symbol on left, realized PnL on right.
          Liquidated positions get an extra orange flame badge. */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider flex-shrink-0',
              isLong
                ? 'bg-bulk-green/15 text-bulk-green'
                : 'bg-bulk-red/15 text-bulk-red'
            )}
          >
            {isLong ? 'LONG' : 'SHORT'}
          </span>
          <span className="font-semibold text-[var(--text-primary)] truncate">
            {p.symbol}
          </span>
          {p.leverage > 0 && (
            <span className="text-[var(--text-tertiary)] text-xs font-mono">
              {p.leverage}x
            </span>
          )}
          {p.liquidated && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bulk-orange/15 text-bulk-orange text-[10px] font-semibold tracking-wider">
              <Flame className="w-3 h-3" />
              LIQ
            </span>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p
            className={cn(
              'font-bold text-base tabular-nums leading-tight',
              isWin ? 'text-bulk-green' : 'text-bulk-red'
            )}
          >
            {isWin ? '+' : '-'}${formatCompact(Math.abs(p.realizedPnl))}
          </p>
          <p
            className={cn(
              'text-[10px] tabular-nums',
              isWin ? 'text-bulk-green/80' : 'text-bulk-red/80'
            )}
          >
            {isWin ? '+' : ''}{pnlPercent.toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Stats grid: entry, close, size, duration. Same compact 4-col
          layout as the open positions for visual consistency. */}
      <div className="grid grid-cols-4 gap-3 text-xs">
        <div>
          <p className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px] mb-0.5">
            Entry
          </p>
          <p className="font-mono text-[var(--text-primary)] tabular-nums">
            ${formatNumber(p.openPrice, 2)}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px] mb-0.5">
            Close
          </p>
          <p className="font-mono text-[var(--text-primary)] tabular-nums">
            ${formatNumber(p.closePrice, 2)}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px] mb-0.5">
            Size
          </p>
          <p className="font-mono text-[var(--text-primary)] tabular-nums">
            {formatNumber(p.size, 4)}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px] mb-0.5">
            Held
          </p>
          <p className="font-mono text-[var(--text-primary)] tabular-nums">
            {formatDuration(duration)}
          </p>
        </div>
      </div>

      {/* Footer: close time + price-move context. Tertiary color so it
          stays out of the way visually. */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-tertiary)] tabular-nums">
        <span>
          Closed{' '}
          {new Date(p.closedAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span className="flex items-center gap-1">
          {priceMovePercent >= 0 ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          Price moved {priceMovePercent >= 0 ? '+' : ''}
          {priceMovePercent.toFixed(2)}%
          {p.fees > 0 && (
            <span className="ml-2">· Fees ${formatNumber(p.fees, 2)}</span>
          )}
        </span>
      </div>
    </div>
  );
}
