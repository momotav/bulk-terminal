'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/api';
import { DEFAULT_COINS, getCoinColor } from '@/lib/coins';
import { useAvailableCoins } from '@/hooks/useAvailableCoins';

/**
 * Single-select sibling to <CoinSelector>.
 *
 * CoinSelector is for "show data for THESE coins" (multi-select, produces a
 * stacked / multi-line chart). CoinPicker is for "focus the view on ONE coin"
 * (Liquidations Summary shows liquidations for the selected coin; Featured
 * Liquidations filters the feed by the selected coin).
 *
 * Both components are designed to look and feel the same — colored swatches,
 * bold defaults at the top of the dropdown, search box, same button styling —
 * so the site feels cohesive even though the underlying semantics differ.
 *
 * Pass `includeAllOption` to get an "ALL" entry at the very top of the
 * dropdown (used by filters like Featured Liquidations that can be unfocused).
 */
export interface CoinPickerProps {
  /** Currently-selected coin name without -USD (e.g. "BTC"), or "ALL" if all-option is enabled. */
  value: string;
  /** Called with the coin the user picked (or "ALL" if they choose the all option). */
  onChange: (coin: string) => void;
  /**
   * Optional filter — when provided, only coins in this list are shown.
   * Used by pages that need to restrict the picker to a subset.
   * Defaults to the full live market list from useAvailableCoins.
   */
  coins?: readonly string[];
  /** If true, adds an "ALL" entry at the top of the dropdown. */
  includeAllOption?: boolean;
  /** Accessible label for the trigger button. */
  ariaLabel?: string;
}

export function CoinPicker({
  value,
  onChange,
  coins: coinsProp,
  includeAllOption,
  ariaLabel,
}: CoinPickerProps) {
  const { coins: liveCoins, loading } = useAvailableCoins();
  const coins = coinsProp ?? liveCoins;

  // Open/close + search + outside-click close.
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
  // Clear search each time the dropdown reopens so old filter state doesn't
  // surprise the user.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (c: string) => searchLower === '' || c.toLowerCase().includes(searchLower);

  const defaultsInDropdown = (DEFAULT_COINS as readonly string[])
    .filter(c => coins.includes(c))
    .filter(matchesSearch);
  const othersInDropdown = coins
    .filter(c => !(DEFAULT_COINS as readonly string[]).includes(c))
    .filter(matchesSearch);

  const pick = (coin: string) => {
    onChange(coin);
    setOpen(false);
  };

  // Color swatch for the selected value in the trigger button. "ALL" gets a
  // neutral color since it's not a coin.
  const triggerColor = value === 'ALL' ? 'var(--text-tertiary)' : getCoinColor(value);

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Trigger button — same visual language as <CoinSelector>'s dropdown
          trigger so the site feels consistent. */}
      <button
        onClick={() => setOpen(v => !v)}
        disabled={loading}
        aria-label={ariaLabel}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
          'border border-[var(--border-color)] bg-[var(--bg-muted)]',
          'text-[var(--text-primary)] hover:bg-[var(--bg-base)] transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        <span
          className="inline-block w-3 h-3 rounded-sm shrink-0"
          style={{ background: triggerColor }}
        />
        <span className="tabular-nums">{value}</span>
        <ChevronDown
          size={14}
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-[220px] z-20 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg shadow-xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-[var(--border-color)]">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search coins..."
              autoFocus
              className="w-full px-3 py-2 text-xs bg-[var(--bg-base)] border border-[var(--border-color)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-secondary)] transition-colors"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {/* Optional "ALL" entry — shows at the top above the defaults,
                for filters that accept an unfocused state (Featured Liquidations). */}
            {includeAllOption && matchesSearch('ALL') && (
              <div className="py-1 border-b border-[var(--border-color)]">
                <PickerRow
                  label="ALL"
                  color="var(--text-tertiary)"
                  active={value === 'ALL'}
                  bold
                  onClick={() => pick('ALL')}
                />
              </div>
            )}

            {/* Defaults — BTC / ETH / SOL rendered bold at the top. */}
            {defaultsInDropdown.length > 0 && (
              <div className="py-1">
                {defaultsInDropdown.map(coin => (
                  <PickerRow
                    key={coin}
                    label={coin}
                    color={getCoinColor(coin)}
                    active={value === coin}
                    bold
                    onClick={() => pick(coin)}
                  />
                ))}
              </div>
            )}

            {/* Separator between defaults and the long tail. */}
            {defaultsInDropdown.length > 0 && othersInDropdown.length > 0 && (
              <div className="border-t border-[var(--border-color)]" />
            )}

            {othersInDropdown.length > 0 && (
              <div className="py-1">
                {othersInDropdown.map(coin => (
                  <PickerRow
                    key={coin}
                    label={coin}
                    color={getCoinColor(coin)}
                    active={value === coin}
                    onClick={() => pick(coin)}
                  />
                ))}
              </div>
            )}

            {defaultsInDropdown.length === 0 && othersInDropdown.length === 0 && !(includeAllOption && matchesSearch('ALL')) && (
              <div className="px-3 py-4 text-xs text-[var(--text-tertiary)] text-center">
                No coins match &ldquo;{search}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// PickerRow — one row inside the dropdown. Mirrors <DropdownRow> inside
// CoinSelector so the two components feel identical. Local copy kept private
// so CoinSelector can diverge if it ever needs to (e.g. check + disabled
// state for max-count enforcement — not relevant here).
// ----------------------------------------------------------------------------
function PickerRow({
  label,
  color,
  active,
  bold,
  onClick,
}: {
  label: string;
  color: string;
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
        style={{ background: color }}
      />
      <span className={cn(
        'flex-1 text-left',
        bold
          ? 'font-semibold text-[var(--text-primary)]'
          : 'font-normal text-[var(--text-secondary)]',
        active && 'text-[var(--text-primary)]'
      )}>
        {label}
      </span>
      {active && (
        <Check size={12} className="text-[var(--text-primary)] shrink-0" strokeWidth={3} />
      )}
    </button>
  );
}
