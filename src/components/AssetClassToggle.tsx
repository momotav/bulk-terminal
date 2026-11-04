'use client';

// All · Crypto · Stocks segmented control.
//
// Bound to the ONE site-wide asset-class value in the store, and rendered
// inside every coin picker plus the Markets table — so the filter can be
// flipped from any chart, and every chart flips together. Same visual
// language as the All/24h toggle on the KPI cards.

import { cn } from '@/lib/api';
import { ASSET_CLASSES, type AssetClass } from '@/lib/coins';
import { useAssetClass } from '@/hooks/useAssetClass';

export interface AssetClassToggleProps {
  /** Compact (inside pickers) or regular (panel headers). */
  size?: 'sm' | 'md';
  /** Optional per-class market counts, shown as a small suffix ("Stocks 8"). */
  counts?: Partial<Record<AssetClass, number>>;
  className?: string;
}

export function AssetClassToggle({ size = 'sm', counts, className }: AssetClassToggleProps) {
  const { assetClass, setAssetClass } = useAssetClass();
  const sm = size === 'sm';
  return (
    <div
      role="radiogroup"
      aria-label="Market class"
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--role-surface-raised)]/60 p-0.5',
        className,
      )}
    >
      {ASSET_CLASSES.map(({ key, label }) => {
        const active = assetClass === key;
        const n = counts?.[key];
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setAssetClass(key)}
            className={cn(
              'rounded-md font-semibold transition-colors',
              sm ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs',
              active
                ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm'
                : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
            )}
          >
            {label}
            {typeof n === 'number' && (
              <span className={cn('ml-1 tabular-nums', active ? 'text-[var(--role-content-muted)]' : 'opacity-70')}>
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
