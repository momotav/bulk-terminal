'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/api';
import {
  DEFAULT_COINS,
  OTHER_KEY,
  getCoinColor,
} from '@/lib/coins';
import { useAvailableCoins } from '@/hooks/useAvailableCoins';

/**
 * Reusable coin selector that matches the Hyperliquid layout:
 *   [BTC] [ETH] [SOL] [coin-selected-by-user...] [Other] [Cumulative*] [Deselect all]
 *   [N coins selected ▾]   — trigger that opens a dropdown of every remaining coin
 *
 * The component is deliberately presentational + controlled: it takes the
 * current enabled set and emits changes via onChange. All persistence (per
 * chart) happens in the parent page.
 *
 * * The "Cumulative" pill is optional — some charts have a cumulative line,
 *   others don't. Pass `extraPills` to render it.
 */
export interface CoinSelectorProps {
  /** Coins the user currently has toggled ON. Can include OTHER_KEY. */
  enabled: readonly string[];
  /** Called whenever the user toggles a coin or selects one from the dropdown. */
  onChange: (enabled: string[]) => void;
  /**
   * Optional extra pills to render to the right of the coin pills — e.g. a
   * "Cumulative Volume" toggle that isn't itself a coin. Each pill gets its
   * own `active`/`onClick` controlled by the parent.
   */
  extraPills?: Array<{
    key: string;
    label: string;
    color: string;
    active: boolean;
    onClick: () => void;
  }>;
}

export function CoinSelector({ enabled, onChange, extraPills }: CoinSelectorProps) {
  const { coins: allCoins, loading } = useAvailableCoins();
  const enabledSet = new Set(enabled);

  // Dropdown open state + outside-click close.
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Figure out which coins should render as visible pills.
  //   - The 3 defaults are always visible pills, even if disabled (the
  //     user can toggle them off without losing the pill).
  //   - Any non-default coin the user has explicitly enabled also becomes
  //     a pill, so the visible pill list grows as the user adds coins.
  //   - "Other" is always a pill.
  //
  // Order: defaults first (stable), then user-added in BULK's listing order.
  const visiblePillCoins: string[] = [
    ...DEFAULT_COINS,
    ...allCoins.filter(
      (c) => !(DEFAULT_COINS as readonly string[]).includes(c) && enabledSet.has(c)
    ),
  ];

  // Coins available to ADD via the dropdown — every known coin that isn't
  // already rendered as a visible pill.
  const addableCoins = allCoins.filter(
    (c) => !(DEFAULT_COINS as readonly string[]).includes(c) && !enabledSet.has(c)
  );

  // Count for the "N coins selected" trigger — everything the user has on
  // except Other (which is an aggregate, not a coin).
  const countForTrigger = enabled.filter((c) => c !== OTHER_KEY).length;

  const togglePill = (coin: string) => {
    const next = new Set(enabledSet);
    if (next.has(coin)) next.delete(coin);
    else next.add(coin);
    onChange(Array.from(next));
  };

  const addCoinFromDropdown = (coin: string) => {
    if (enabledSet.has(coin)) return; // already on
    onChange([...enabled, coin]);
    setOpen(false);
  };

  const deselectAll = () => {
    // Remove all coins but keep Other and any extra pill keys in their own state.
    // Extra pills are controlled by the parent so we don't touch them.
    onChange([]);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Row of pills: coins + Other + extras (e.g. Cumulative) + Deselect all */}
      <div className="flex flex-wrap items-center gap-2">
        {visiblePillCoins.map((coin) => (
          <CoinPill
            key={coin}
            label={coin}
            color={getCoinColor(coin)}
            active={enabledSet.has(coin)}
            onClick={() => togglePill(coin)}
          />
        ))}
        <CoinPill
          key={OTHER_KEY}
          label="Others"
          color={getCoinColor(OTHER_KEY)}
          active={enabledSet.has(OTHER_KEY)}
          onClick={() => togglePill(OTHER_KEY)}
        />
        {extraPills?.map((p) => (
          <CoinPill
            key={p.key}
            label={p.label}
            color={p.color}
            active={p.active}
            onClick={p.onClick}
          />
        ))}
        <button
          onClick={deselectAll}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Deselect all
        </button>
      </div>

      {/* Dropdown trigger — shows total coin count + expands to a picker */}
      <div className="relative inline-block" ref={dropdownRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={loading || addableCoins.length === 0}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium',
            'border border-[var(--border-color)] bg-[var(--bg-muted)]',
            'text-[var(--text-primary)] hover:bg-[var(--bg-base)] transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          <span className="tabular-nums">
            {countForTrigger} {countForTrigger === 1 ? 'coin' : 'coins'} selected
          </span>
          <ChevronDown
            size={14}
            className={cn('transition-transform', open && 'rotate-180')}
          />
        </button>

        {open && addableCoins.length > 0 && (
          <div className="absolute left-0 mt-1 min-w-[160px] max-h-64 overflow-y-auto z-20 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg shadow-xl py-1">
            {addableCoins.map((coin) => (
              <button
                key={coin}
                onClick={() => addCoinFromDropdown(coin)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-base)] transition-colors"
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: getCoinColor(coin) }}
                />
                <span className="flex-1 text-left">{coin}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Pill — a single coin toggle with a colored checkbox swatch.
// ----------------------------------------------------------------------------

function CoinPill({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
        active
          ? 'border-[var(--border-color)] bg-[var(--bg-muted)] text-[var(--text-primary)]'
          : 'border-[var(--border-color)] bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      )}
    >
      {/* Colored swatch doubles as a "selected" indicator — filled when active,
          outlined when not. Keeps the UI legible without a separate checkbox. */}
      <span
        className="inline-block w-3 h-3 rounded-sm border"
        style={{
          background: active ? color : 'transparent',
          borderColor: color,
        }}
      >
        {active && <Check size={10} className="text-[var(--bg-base)]" strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}
