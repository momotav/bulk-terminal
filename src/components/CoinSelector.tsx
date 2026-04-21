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

  // Dropdown open state + outside-click close + search filter.
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
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
  // Clear the search box every time the dropdown is re-opened so stale
  // filter state doesn't surprise the user.
  useEffect(() => {
    if (!open) setSearch('');
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

  // Split the full coin universe into "defaults" (rendered at the top of the
  // dropdown, bolded) and "others" (everything else, below a separator).
  // Matches Hyperliquid's dropdown layout in the reference screenshot.
  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (coin: string) =>
    searchLower === '' || coin.toLowerCase().includes(searchLower);

  const defaultsInDropdown = (DEFAULT_COINS as readonly string[]).filter(matchesSearch);
  const othersInDropdown = allCoins
    .filter((c) => !(DEFAULT_COINS as readonly string[]).includes(c))
    .filter(matchesSearch);

  // Count for the "N coins selected" trigger — everything the user has on
  // except Other (which is an aggregate, not a coin).
  const countForTrigger = enabled.filter((c) => c !== OTHER_KEY).length;

  const togglePill = (coin: string) => {
    const next = new Set(enabledSet);
    if (next.has(coin)) next.delete(coin);
    else next.add(coin);
    onChange(Array.from(next));
  };

  // Toggle a coin from INSIDE the dropdown. Unlike clicking a pill this does
  // NOT close the dropdown — user can multi-select quickly without reopening.
  // (Hyperliquid behaves the same way in their coin picker.)
  const toggleFromDropdown = (coin: string) => {
    togglePill(coin);
    // Explicitly do NOT call setOpen(false) — menu stays open.
  };

  const deselectAll = () => {
    // Remove all coins but keep Other and any extra pill keys in their own state.
    // Extra pills are controlled by the parent so we don't touch them.
    onChange([]);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Single row: coin pills + Other + extras (Cumulative) + Deselect all +
          the dropdown trigger. All in one row so the chart header stays
          compact, matching Hyperliquid's layout. */}
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

      {/* Dropdown trigger — shows total coin count + expands to a picker */}
      <div className="relative inline-block" ref={dropdownRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={loading}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
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

        {open && (
          <div className="absolute right-0 mt-1 w-[260px] z-20 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg shadow-xl overflow-hidden">
            {/* Search box */}
            <div className="p-2 border-b border-[var(--border-color)]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search coins..."
                autoFocus
                className="w-full px-3 py-2 text-xs bg-[var(--bg-base)] border border-[var(--border-color)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-secondary)] transition-colors"
              />
            </div>

            {/* Deselect all (inside the dropdown, like Hyperliquid) */}
            <button
              onClick={deselectAll}
              className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-base)] transition-colors border-b border-[var(--border-color)]"
            >
              Deselect All
            </button>

            <div className="max-h-64 overflow-y-auto">
              {/* Default coins — rendered bold at the top of the list.
                  Matches Hyperliquid's styling where BTC / ETH / HYPE / SOL
                  are visually distinguished from the long tail. */}
              {defaultsInDropdown.length > 0 && (
                <div className="py-1">
                  {defaultsInDropdown.map((coin) => (
                    <DropdownRow
                      key={coin}
                      coin={coin}
                      active={enabledSet.has(coin)}
                      bold
                      onClick={() => toggleFromDropdown(coin)}
                    />
                  ))}
                </div>
              )}

              {/* Visual separator between defaults and the rest. */}
              {defaultsInDropdown.length > 0 && othersInDropdown.length > 0 && (
                <div className="border-t border-[var(--border-color)]" />
              )}

              {/* Everything else */}
              {othersInDropdown.length > 0 && (
                <div className="py-1">
                  {othersInDropdown.map((coin) => (
                    <DropdownRow
                      key={coin}
                      coin={coin}
                      active={enabledSet.has(coin)}
                      onClick={() => toggleFromDropdown(coin)}
                    />
                  ))}
                </div>
              )}

              {defaultsInDropdown.length === 0 && othersInDropdown.length === 0 && (
                <div className="px-3 py-4 text-xs text-[var(--text-tertiary)] text-center">
                  No coins match &ldquo;{search}&rdquo;
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// DropdownRow — one row inside the coin picker dropdown. Shows a colored
// swatch, coin name, and a check mark when that coin is currently enabled.
// ----------------------------------------------------------------------------
function DropdownRow({
  coin,
  active,
  bold,
  onClick,
}: {
  coin: string;
  active: boolean;
  bold?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-[var(--bg-base)] transition-colors"
    >
      <span
        className="inline-block w-3 h-3 rounded-sm shrink-0"
        style={{ background: getCoinColor(coin) }}
      />
      <span className={cn(
        'flex-1 text-left',
        bold
          ? 'font-semibold text-[var(--text-primary)]'
          : 'font-normal text-[var(--text-secondary)]'
      )}>
        {coin}
      </span>
      {active && (
        <Check size={12} className="text-[var(--text-primary)] shrink-0" strokeWidth={3} />
      )}
    </button>
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
