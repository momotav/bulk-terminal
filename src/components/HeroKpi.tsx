'use client';

// Hyperliquid-style hero KPI card: a big animated number over a full-bleed
// sparkline, a day-over-day change stat, a supporting sub-line, an optional
// per-card All/24h toggle, and an optional click action. Shared across the
// dashboard, analytics, liquidations, pre-deposit, and staking pages so every
// KPI strip reads the same.

import type { ReactNode } from 'react';
import { Sparkline } from '@/components/Sparkline';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { formatCompact, cn } from '@/lib/api';

// Module-scope formatters so their identity is stable across renders — the
// AnimatedNumber keys its motion off the `format` prop.
export const fmtUsd = (n: number): string => `$${formatCompact(n)}`;
export const fmtCount = (n: number): string => Math.round(n).toLocaleString();

export interface HeroKpiProps {
  label: ReactNode;
  rawValue: number;
  format: (n: number) => string;
  changePct?: number | null;
  sub?: ReactNode;
  series: number[];
  color?: string;
  loading?: boolean;
  onClick?: () => void;
  mode?: 'total' | '24h';
  onToggle?: (m: 'total' | '24h') => void;
}

// Day-over-day % change from a daily series (the little green/red stat).
export function pctChange(s: number[]): number | null {
  if (s.length < 2) return null;
  const prev = s[s.length - 2];
  if (!prev) return null;
  return ((s[s.length - 1] - prev) / Math.abs(prev)) * 100;
}

export function HeroKpi({
  label, rawValue, format, changePct, sub, series, color = 'var(--accent)', loading, onClick,
  mode, onToggle,
}: HeroKpiProps) {
  const clickable = !!onClick;
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } } : undefined}
      className={cn(
        'stat-card-interactive group relative flex min-h-[132px] w-full flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--role-line)] bg-[var(--role-surface)] px-4 py-3.5 text-left',
        clickable && 'cursor-pointer',
      )}
    >
      {/* Sparkline fills the lower part of the card as a soft backdrop. Keyed by
          mode so it re-runs its draw-on animation when the toggle flips. */}
      {series.length >= 2 && !loading && (
        <div key={mode ?? 'x'} className="pointer-events-none absolute inset-x-0 bottom-0 h-[86px] opacity-90">
          <Sparkline data={series} color={color} height={86} className="h-full w-full" />
        </div>
      )}
      <div className="relative z-10 pr-16">
        {/* Fixed two-line height so a long label that wraps (e.g. "Consensus
            Latency · median") and a short one-line label both reserve the same
            space — the number and sub-line then start at the same Y on every
            card, so the secondary text is level across the whole KPI row. */}
        <div className="flex h-[30px] items-start gap-1.5 overflow-hidden text-[11px] font-medium leading-[15px] text-[var(--role-content-subtle)]">{label}</div>
        {loading ? (
          <div className="mt-1 h-[32px] w-28 animate-pulse rounded bg-[var(--role-surface-raised)]" />
        ) : (
          <div className="mt-1 text-[32px] font-bold font-sans leading-none tracking-tight tabular-nums text-[var(--role-content)]">
            <AnimatedNumber value={rawValue} format={format} />
          </div>
        )}
        {/* Change % + sub, kept close under the number (and above the sparkline
            backdrop). Stack on narrow cards so the long L/H line never collides
            with the % or wraps mid-value; inline on wider ones. */}
        <div className="mt-1 flex flex-col gap-0.5 text-[11px] sm:flex-row sm:items-center sm:gap-2">
          {changePct != null && Number.isFinite(changePct) && (
            <span className={cn('font-semibold tabular-nums', changePct >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>
              {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(1)}%
            </span>
          )}
          {sub != null && <span className="whitespace-nowrap text-[var(--role-content-subtle)]">{sub}</span>}
        </div>
      </div>

      {/* Per-card All / 24h toggle. stopPropagation so it doesn't trigger the
          card's own click. */}
      {mode && onToggle && (
        <span
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2.5 top-2.5 z-20 inline-flex items-center gap-0.5 rounded-md bg-[var(--role-surface-raised)]/90 p-0.5 backdrop-blur-sm"
        >
          {(['total', '24h'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggle(m); }}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors',
                mode === m ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
              )}
            >
              {m === 'total' ? 'All' : '24h'}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
