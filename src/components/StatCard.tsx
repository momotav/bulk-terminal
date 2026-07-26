import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/api';

// ----------------------------------------------------------------------------
// StatCard — the ONE KPI card for the whole app.
//
// Every KPI strip (dashboard, analytics/*, explorer, whale tracker) renders
// through this component so they can't drift apart. Style is fixed here:
// filled surface, hairline border, --radius-md, a sentence-case micro-label,
// and a mono tabular value. Only the *content* — and one `size` dial — varies.
//
//   value      — any node: a plain string/number, an <AnimatedNumber/>, or a
//                <FlashingValue/>. It inherits the card's mono typography and
//                colour, so callers pass content, not styling.
//   valueColor — override the value colour (e.g. bid/ask). Defaults to the
//                neutral content role — colour is spent only where a page
//                deliberately wants it.
//   unit       — small trailing unit (e.g. "bps", "USDC").
//   sub        — one-line caption under the value.
//   loading    — swaps the value for a skeleton while data is in flight.
//   size       — 'default' (26px value) or 'compact' (20px, tighter) for
//                strips that should sit quietly under a hero. Same component,
//                same style family — a dial, NOT a fork, so it can't drift.
// ----------------------------------------------------------------------------

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  valueColor?: string;
  loading?: boolean;
  size?: 'default' | 'compact';
  className?: string;
  style?: CSSProperties;
}

const SIZES = {
  default: { pad: 'px-4 py-3', label: 'text-[11px]', value: 'text-[26px]', gap: 'mt-2', skel: 'h-[26px]', unit: 'text-[11px]', sub: 'mt-1.5 text-[11px]' },
  compact: { pad: 'px-3.5 py-2.5', label: 'text-[10px]', value: 'text-[20px]', gap: 'mt-1.5', skel: 'h-[20px]', unit: 'text-[10px]', sub: 'mt-1 text-[10px]' },
} as const;

export function StatCard({ label, value, unit, sub, valueColor, loading, size = 'default', className, style }: StatCardProps) {
  const s = SIZES[size];
  return (
    <div
      style={style}
      className={cn(
        'rounded-[var(--radius-md)] border border-[var(--role-line)] bg-[var(--role-surface)]',
        s.pad,
        className,
      )}
    >
      <span className={cn('block font-medium leading-tight text-[var(--role-content-subtle)]', s.label)}>
        {label}
      </span>

      {loading ? (
        <div className={cn('w-24 animate-pulse rounded bg-[var(--role-surface-raised)]', s.gap, s.skel)} />
      ) : (
        <div
          className={cn('flex items-baseline gap-1 font-bold font-mono leading-none tracking-tight tabular-nums', s.gap, s.value)}
          style={{ color: valueColor ?? 'var(--role-content)' }}
        >
          <span>{value}</span>
          {unit && (
            <span className={cn('font-medium text-[var(--role-content-subtle)]', s.unit)}>{unit}</span>
          )}
        </div>
      )}

      {sub != null && sub !== '' && (
        <p className={cn('truncate text-[var(--role-content-subtle)]', s.sub)}>{sub}</p>
      )}
    </div>
  );
}
