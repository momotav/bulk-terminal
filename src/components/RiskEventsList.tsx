'use client';

import { useEffect, useState } from 'react';
import { Flame, Zap, AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronUp } from 'lucide-react';
import {
  wallet,
  formatNumber,
  formatCompact,
  timeAgo,
  cn,
  type RiskEvent,
} from '@/lib/api';

// ----------------------------------------------------------------------------
// RiskEventsList
//
// Wallet liquidation + ADL history sourced from BULK's POST /account
// type:"riskHistory" endpoint (v1.0.15). Replaces the older DB-backed panel
// (which was actually never rendered) and is the first surface to expose
// BULK's richer event fields:
//
//   - marginPrior / marginAfter — balance snapshot around the event
//   - reason — human-readable cause ("equity X < maintenance margin Y")
//   - iso flag — isolated vs cross-margin events
//
// Layout: compact table. Header row + one row per event. Margin delta
// shown inline with a colored arrow so users see the dollar damage at a
// glance without expanding anything.
//
// Empty / truncated / error states all have non-alarming copy — these
// events are rare by nature, so "no events" is a normal state to render,
// not a problem.
// ----------------------------------------------------------------------------

interface Props {
  address: string;
  /** Max events to fetch. Default 50. */
  limit?: number;
  /** Filter by event type. Default 'all'. */
  type?: 'liquidation' | 'adl' | 'all';
}

// Initial visible row count. Anything beyond this is hidden behind an
// expand button so the panel doesn't dominate the wallet page by default —
// most users care about the most recent few; the rest is on-demand.
const COLLAPSED_COUNT = 10;

export function RiskEventsList({ address, limit = 50, type = 'all' }: Props) {
  const [events, setEvents] = useState<RiskEvent[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(false);
    // Reset expanded state when the wallet changes — navigating between
    // wallets should always land on the collapsed default view.
    setIsExpanded(false);
    wallet
      .getLiquidations(address, { limit, type })
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events);
        setTruncated(res.truncated);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [address, limit, type]);

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg flex flex-col">
      <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-bulk-orange" />
          <h2 className="font-semibold">Risk Events</h2>
          {events && events.length > 0 && (
            <span className="text-xs text-[var(--text-tertiary)] font-mono">
              {events.length}
              {truncated ? '+' : ''}
            </span>
          )}
        </div>
      </div>

      <RiskEventsBody
        events={events}
        error={error}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded((v) => !v)}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Body — split out so loading / empty / populated all live in one place
// instead of nesting ternaries in the parent.
// ----------------------------------------------------------------------------
function RiskEventsBody({
  events,
  error,
  isExpanded,
  onToggleExpand,
}: {
  events: RiskEvent[] | null;
  error: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  // Loading: skeleton rows. Matches ClosedPositionsList style so the
  // wallet page doesn't feel inconsistent between panels.
  if (events === null) {
    return (
      <div className="divide-y divide-[var(--border-color)]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="p-4">
            <div className="h-4 bg-[var(--bg-secondary-20)]/40 rounded w-3/4 mb-2 animate-pulse" />
            <div className="h-3 bg-[var(--bg-secondary-20)]/30 rounded w-1/2 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-8 text-center text-[var(--text-tertiary)]">
        <AlertTriangle className="w-10 h-10 mx-auto mb-2 opacity-30" />
        {error ? (
          <>
            <p className="text-sm">Couldn’t load risk events</p>
            <p className="text-xs mt-1">BULK may be temporarily unavailable</p>
          </>
        ) : (
          <>
            <p className="text-sm">No liquidations or ADL events</p>
            <p className="text-xs mt-1">
              This wallet has a clean record on BULK’s recent history
            </p>
          </>
        )}
      </div>
    );
  }

  // Collapse logic: only show the first N rows unless expanded. The toggle
  // button below the table flips state and is only rendered when the
  // overflow actually exists (no point showing "Show 0 more").
  const hasOverflow = events.length > COLLAPSED_COUNT;
  const visible = isExpanded ? events : events.slice(0, COLLAPSED_COUNT);
  const hiddenCount = events.length - COLLAPSED_COUNT;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
              <th className="text-left font-medium px-4 py-2">Event</th>
              <th className="text-left font-medium px-4 py-2">Market</th>
              <th className="text-right font-medium px-4 py-2">Size</th>
              <th className="text-right font-medium px-4 py-2">Price</th>
              <th className="text-right font-medium px-4 py-2">Value</th>
              <th className="text-right font-medium px-4 py-2">Margin Δ</th>
              <th className="text-left font-medium px-4 py-2 hidden md:table-cell">
                Reason
              </th>
              <th className="text-right font-medium px-4 py-2">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {visible.map((e) => (
              <RiskEventRow key={`${e.timestamp}-${e.sequence}-${e.symbol}`} e={e} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Expand / collapse toggle. Only mounted when the list actually has
          rows beyond the collapsed threshold — otherwise it'd be misleading
          ("Show 0 more"). Lives outside the table so it gets full width
          regardless of horizontal scroll on narrow viewports. */}
      {hasOverflow && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="w-full px-4 py-2.5 border-t border-[var(--border-color)] text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary-20)]/30 transition-colors flex items-center justify-center gap-1.5 font-medium"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Show {hiddenCount} more
            </>
          )}
        </button>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// One row per event. Aims to convey at a glance: what happened, on what,
// for how much, how much it cost the margin balance, why, and when.
// ----------------------------------------------------------------------------
function RiskEventRow({ e }: { e: RiskEvent }) {
  const isLiq = e.eventType === 'liquidation';
  const isLong = e.side === 'long';
  const marginLoss = e.marginDelta < 0;

  return (
    <tr className="hover:bg-[var(--bg-secondary-20)]/30 transition-colors">
      {/* Event type badge — flame for liq, zap for adl. Both orange (they
          share visual weight as "force-close events"); the icon and label
          do the differentiation. */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider',
              'bg-bulk-orange/15 text-bulk-orange'
            )}
          >
            {isLiq ? (
              <Flame className="w-3 h-3" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            {isLiq ? 'LIQ' : 'ADL'}
          </span>
          {e.iso && (
            <span
              className="px-1 py-0.5 rounded bg-[var(--bg-secondary-20)] text-[var(--text-tertiary)] text-[9px] font-mono uppercase tracking-wider"
              title="Isolated-margin event — affected only this market’s isolated collateral"
            >
              iso
            </span>
          )}
        </div>
      </td>

      {/* Market + position side. Long/short here is the position that got
          force-closed, derived backend-side from BULK's fill direction. */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider',
              isLong
                ? 'bg-bulk-green/15 text-bulk-green'
                : 'bg-bulk-red/15 text-bulk-red'
            )}
          >
            {isLong ? 'LONG' : 'SHORT'}
          </span>
          <span className="font-medium text-[var(--text-primary)]">
            {e.symbol}
          </span>
        </div>
      </td>

      <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
        {formatNumber(e.size, 4)}
      </td>

      <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
        ${formatNumber(e.price, 4)}
      </td>

      <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
        ${formatCompact(e.value)}
      </td>

      {/* Margin delta — the headline new field. Arrow + colored number.
          Always negative for liquidations (you lose margin); shown
          explicitly with an arrow so even a skim picks up the direction. */}
      <td className="px-4 py-3 text-right">
        <div
          className={cn(
            'inline-flex items-center gap-1 font-mono tabular-nums text-sm',
            marginLoss ? 'text-bulk-red' : 'text-bulk-green'
          )}
          title={`Margin: $${formatNumber(e.marginPrior, 2)} → $${formatNumber(e.marginAfter, 2)}`}
        >
          {marginLoss ? (
            <ArrowDown className="w-3 h-3" />
          ) : (
            <ArrowUp className="w-3 h-3" />
          )}
          ${formatCompact(Math.abs(e.marginDelta))}
        </div>
      </td>

      {/* Reason — the rich field that justifies the whole migration.
          Hidden on small screens (truncates ugly); on hover/title attr
          we always carry the full text so screen readers and curious
          users can still get to it. */}
      <td
        className="px-4 py-3 text-xs text-[var(--text-tertiary)] hidden md:table-cell max-w-[280px] truncate"
        title={e.reason}
      >
        {e.reason || '—'}
      </td>

      <td
        className="px-4 py-3 text-right text-xs text-[var(--text-tertiary)] tabular-nums whitespace-nowrap"
        title={new Date(e.timestamp).toISOString()}
      >
        {timeAgo(e.timestamp)}
      </td>
    </tr>
  );
}

export default RiskEventsList;
