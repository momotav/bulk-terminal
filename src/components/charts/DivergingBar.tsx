'use client';

import { cn } from '@/lib/api';

/**
 * A bar from a centre line inside a track that shows the full length, so a short
 * bar reads as "small next to the biggest" rather than a stray dot.
 * `value` is −1 … 1 (share of the largest value in the set): + grows right in
 * green, − grows left in red.
 */
export function DivergingBar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  const w = Math.abs(v) * 50;
  return (
    <span className={cn('relative block h-2.5 overflow-hidden rounded-full bg-[var(--bg-base)] ring-1 ring-inset ring-[var(--border-color)]', className)}>
      <span className="absolute inset-y-0 left-1/2 z-[1] w-px -translate-x-1/2 bg-[var(--text-tertiary)] opacity-60" />
      {w > 0 && (
        <span className={cn('absolute inset-y-0 transition-all duration-700 ease-out', v >= 0 ? 'grad-pos-r rounded-r-full' : 'grad-neg-l rounded-l-full')}
          style={v >= 0 ? { left: '50%', width: `max(${w}%, 2px)` } : { right: '50%', width: `max(${w}%, 2px)` }} />
      )}
    </span>
  );
}
