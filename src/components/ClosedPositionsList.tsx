'use client';

import { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Flame } from 'lucide-react';
import { wallet, formatNumber, formatCompact, cn, type ClosedPosition } from '@/lib/api';
import { formatDuration } from '@/lib/positionWalk';

// Styled hover popover for the closed-position PnL breakdown. Anchored
// to the headline number, shown on mouse enter / hidden on leave with
// no delay. Uses absolute positioning so it doesn't push other content
// around. `pointer-events-none` lets clicks pass through to the parent
// row, so clicking the number still opens the position chart modal.
//
// Desktop only — hover doesn't exist on touch and the row tap already
// navigates to the chart. Users on mobile see the net headline number
// directly; the breakdown is a power-user affordance.
function PnlBreakdownPopover({
  position,
  isWin,
}: {
  position: ClosedPosition;
  isWin: boolean;
}) {
  const fmt = (n: number): string => {
    const sign = n >= 0 ? '+' : '-';
    return `${sign}$${formatNumber(Math.abs(n), 2)}`;
  };
  // Each row: (label, value, optional value-tone). Tone null means
  // tertiary text color. Color the Net line to match the win/loss
  // headline so the eye links the two numbers visually.
  const rows: { label: string; value: string; tone: 'win' | 'loss' | null }[] = [
    { label: 'Gross', value: fmt(position.grossPnl), tone: position.grossPnl >= 0 ? 'win' : 'loss' },
    { label: 'Fees', value: fmt(position.fees), tone: position.fees >= 0 ? 'win' : 'loss' },
    { label: 'Funding', value: fmt(position.funding), tone: position.funding >= 0 ? 'win' : 'loss' },
  ];
  return (
    <div
      role="tooltip"
      className={cn(
        // Position: just below the PnL number, right-aligned so it never
        // overflows the panel right edge.
        'absolute right-0 top-full mt-1.5 z-20',
        // Card: matches the wallet page panel design vocabulary —
        // muted bg, border token, soft shadow for elevation.
        'rounded-md border border-[var(--border-color)] bg-[var(--bg-muted)]',
        'shadow-lg shadow-black/30',
        // Sizing — tight, content-driven width.
        'min-w-[180px] px-3 py-2.5',
        // No interaction: hover capture stays on parent; clicks pass through.
        'pointer-events-none',
      )}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-4 text-xs leading-relaxed"
        >
          <span className="text-[var(--text-tertiary)] uppercase tracking-wider text-[10px]">
            {row.label}
          </span>
          <span
            className={cn(
              'font-mono tabular-nums',
              row.tone === 'win' && 'text-bulk-green',
              row.tone === 'loss' && 'text-bulk-red',
              !row.tone && 'text-[var(--text-secondary)]',
            )}
          >
            {row.value}
          </span>
        </div>
      ))}
      {/* Separator + Net total. Border-top draws the divider; the Net
          row reuses the same flex layout for alignment. */}
      <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="text-[var(--text-secondary)] uppercase tracking-wider text-[10px] font-semibold">
            Net
          </span>
          <span
            className={cn(
              'font-mono tabular-nums font-bold',
              isWin ? 'text-bulk-green' : 'text-bulk-red',
            )}
          >
            {fmt(position.realizedPnl)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Wrapper around the PnL number + % that shows the breakdown popover on
// hover. Split out from the row component so the hover state can live in
// its own subtree without re-rendering the whole row on every mouse
// move. `relative` anchors the popover; the popover itself is
// pointer-events-none so clicks still hit the row's button wrapper
// underneath.
function PnlNumberWithBreakdown({
  p,
  isWin,
  pnlPercent,
}: {
  p: ClosedPosition;
  isWin: boolean;
  pnlPercent: number;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p
        className={cn(
          'font-bold text-base tabular-nums leading-tight cursor-help',
          isWin ? 'text-bulk-green' : 'text-bulk-red',
        )}
      >
        {isWin ? '+' : '-'}${formatCompact(Math.abs(p.realizedPnl))}
      </p>
      <p
        className={cn(
          'text-[10px] tabular-nums',
          isWin ? 'text-bulk-green/80' : 'text-bulk-red/80',
        )}
      >
        {isWin ? '+' : ''}{pnlPercent.toFixed(2)}%
      </p>
      {hovered && <PnlBreakdownPopover position={p} isWin={isWin} />}
    </div>
  );
}

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
  /** Optional click handler — when provided, each row becomes clickable
   *  and fires onSelect with the position. The wallet page wires this
   *  up to open the chart modal in closed-position mode. When omitted
   *  rows render as static (read-only). */
  onSelect?: (p: ClosedPosition) => void;
}

export function ClosedPositionsList({ address, symbol, limit = 50, onSelect }: Props) {
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
        <ClosedPositionRow
          key={`${p.symbol}-${p.closedAt}-${i}`}
          p={p}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// One row per closed position. Layout: side+symbol on the left, PnL on
// the right (color-coded). Below: entry → close prices + duration.
function ClosedPositionRow({
  p,
  onSelect,
}: {
  p: ClosedPosition;
  onSelect?: (p: ClosedPosition) => void;
}) {
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

  // Render as a button when clickable, plain div otherwise. The button
  // form preserves the same visual layout but adds keyboard focus and
  // the cursor affordance.
  const Wrapper = onSelect ? 'button' : 'div';
  const wrapperProps = onSelect
    ? {
        type: 'button' as const,
        onClick: () => onSelect(p),
        className:
          'w-full text-left p-4 hover:bg-[var(--bg-secondary-20)]/30 transition-colors cursor-pointer group',
      }
    : {
        className: 'p-4 hover:bg-[var(--bg-secondary-20)]/30 transition-colors',
      };

  return (
    <Wrapper {...wrapperProps}>
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
          {/* PnL number with hover popover showing the gross → net
              breakdown. The wrapping div is `relative` so the popover
              anchors here; clicks still propagate to the parent button
              that opens the chart modal (popover is pointer-events-none).
              We treat the wrapper as an inline group via onMouseEnter /
              onMouseLeave so the popover stays visible while the cursor
              is anywhere within the right-side number block. */}
          <PnlNumberWithBreakdown p={p} isWin={isWin} pnlPercent={pnlPercent} />
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
        </span>
      </div>
    </Wrapper>
  );
}
