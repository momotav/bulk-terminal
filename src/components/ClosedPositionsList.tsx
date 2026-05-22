'use client';

import { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Flame } from 'lucide-react';
import { wallet, formatNumber, formatCompact, cn, timeAgo, type ClosedPosition } from '@/lib/api';
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
  /** Visual density mode.
   *  - 'cards' (default): each position renders as a multi-line card
   *    with entry/close/size/held on a metadata row. Used by the chart
   *    modal where vertical space is generous and rows are sparse.
   *  - 'table': dense single-row-per-position table format with sortable
   *    headers. Used by the wallet detail page where the panel sits
   *    full-width below the chart and benefits from compact rows that
   *    let users scan many trades at once. Mirrors Hyperdash's positions
   *    table convention. */
  density?: 'cards' | 'table';
}

export function ClosedPositionsList({ address, symbol, limit = 50, onSelect, density = 'cards' }: Props) {
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

  if (density === 'table') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
              <th className="text-left font-medium px-4 py-2.5">Market</th>
              <th className="text-right font-medium px-4 py-2.5">Size</th>
              <th className="text-right font-medium px-4 py-2.5">Entry</th>
              <th className="text-right font-medium px-4 py-2.5">Close</th>
              <th className="text-right font-medium px-4 py-2.5">PnL</th>
              <th className="text-right font-medium px-4 py-2.5 hidden md:table-cell">PnL %</th>
              <th className="text-right font-medium px-4 py-2.5 hidden lg:table-cell">Held</th>
              <th className="text-right font-medium px-4 py-2.5">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {positions.map((p, i) => (
              <ClosedPositionTableRow
                key={`${p.symbol}-${p.closedAt}-${i}`}
                p={p}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
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

// ----------------------------------------------------------------------------
// ClosedPositionTableRow
//
// Single-line dense table row variant. Mirrors Hyperdash's positions
// table layout: market, size, entry, close, PnL, %, held, time-ago.
// Clickable to open the chart modal when `onSelect` is wired.
//
// The PnL cell carries the same hover popover as the card variant
// (gross/fees/net breakdown) so the table doesn't lose the rich
// breakdown affordance. All other cells are plain text — the row's
// information density is the point.
// ----------------------------------------------------------------------------
function ClosedPositionTableRow({
  p,
  onSelect,
}: {
  p: ClosedPosition;
  onSelect?: (p: ClosedPosition) => void;
}) {
  const isWin = p.realizedPnl >= 0;
  const isLong = p.side === 'long';
  const notionalAtOpen = p.size * p.openPrice;
  const pnlPercent = notionalAtOpen > 0 ? (p.realizedPnl / notionalAtOpen) * 100 : 0;
  const duration = p.closedAt - p.openedAt;
  const handleClick = onSelect ? () => onSelect(p) : undefined;
  return (
    <tr
      className={cn(
        'transition-colors',
        onSelect && 'cursor-pointer hover:bg-[var(--bg-secondary-20)]/30',
      )}
      onClick={handleClick}
    >
      {/* Market cell — side badge + symbol + LIQ flag if force-closed. */}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider',
              isLong
                ? 'bg-bulk-green/15 text-bulk-green'
                : 'bg-bulk-red/15 text-bulk-red',
            )}
          >
            {isLong ? 'LONG' : 'SHORT'}
          </span>
          <span className="font-medium text-[var(--text-primary)]">{p.symbol}</span>
          {p.liquidated && (
            <span
              className="inline-flex items-center gap-1 px-1 py-0.5 rounded bg-bulk-orange/15 text-bulk-orange text-[9px] font-semibold tracking-wider"
              title="Force-closed via liquidation"
            >
              <Flame className="w-2.5 h-2.5" />
              LIQ
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
        {formatNumber(p.size, 4)}
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
        ${formatNumber(p.openPrice, 4)}
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
        ${formatNumber(p.closePrice, 4)}
      </td>
      {/* PnL with hover breakdown — reuses the existing popover component. */}
      <td className="px-4 py-2.5 text-right">
        <PnlNumberWithBreakdownInline p={p} isWin={isWin} />
      </td>
      <td
        className={cn(
          'px-4 py-2.5 text-right font-mono tabular-nums hidden md:table-cell',
          isWin ? 'text-bulk-green/80' : 'text-bulk-red/80',
        )}
      >
        {isWin ? '+' : ''}{pnlPercent.toFixed(2)}%
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-[var(--text-tertiary)] tabular-nums hidden lg:table-cell">
        {formatDuration(duration)}
      </td>
      <td
        className="px-4 py-2.5 text-right text-xs text-[var(--text-tertiary)] tabular-nums whitespace-nowrap"
        title={new Date(p.closedAt).toISOString()}
      >
        {timeAgo(p.closedAt)}
      </td>
    </tr>
  );
}

// Inline-only variant of the PnL number with hover breakdown. Different
// from PnlNumberWithBreakdown above because the table row doesn't need
// the percent line below (that's its own column) — just the number
// with the hover popover.
function PnlNumberWithBreakdownInline({ p, isWin }: { p: ClosedPosition; isWin: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className={cn(
          'font-bold tabular-nums cursor-help',
          isWin ? 'text-bulk-green' : 'text-bulk-red',
        )}
      >
        {isWin ? '+' : '-'}${formatCompact(Math.abs(p.realizedPnl))}
      </span>
      {hovered && <PnlBreakdownPopover position={p} isWin={isWin} />}
    </div>
  );
}
