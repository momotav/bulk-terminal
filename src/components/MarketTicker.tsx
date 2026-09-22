'use client';

// Market ticker strip.
//
// Mirrors the band BULK Exchange runs directly under its nav
// ("ETH-USD -0.57%  BTC-USD -0.24%  SOL-USD -0.65%"). Every active market,
// last price and 24h change, on one hairline-bounded line.
//
// Deliberately not a marquee. Auto-scrolling text is unreadable on a
// surface whose whole job is letting you check a number at a glance, and
// it would fight the live-updating values. It scrolls horizontally by
// hand when it overflows instead.

import { type BulkTicker, formatPrice } from '@/hooks/useTickers';
import { AnimatedNumber } from './AnimatedNumber';
import { CoinIcon } from './CoinIcon';

const coinOf = (symbol: string) => symbol.replace(/-USD$/i, '');

interface MarketTickerProps {
  tickers: BulkTicker[];
  loading: boolean;
}

export function MarketTicker({ tickers, loading }: MarketTickerProps) {
  if (loading) {
    return (
      <div className="h-[34px] animate-pulse rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)]" />
    );
  }

  if (tickers.length === 0) return null;

  // Stable display order. The shared hook sorts by volume, and that ranking
  // can flip between polls — which makes ticker items jump sideways as they
  // swap places. Sorting the strip by symbol instead pins each market in a
  // fixed spot so only the numbers ever move, never the layout.
  const ordered = [...tickers].sort((a, b) => a.symbol.localeCompare(b.symbol));

  return (
    // `relative` so the edge-fade masks can sit over the scrolling row — they
    // signal there's more to scroll without a hard clip, the way a pro tape does.
    <div className="relative rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)]">
      <div className="scrollbar-hide overflow-x-auto rounded-[var(--radius-sm)]">
        <div className="flex items-stretch divide-x divide-[var(--role-line-subtle)]">
          {ordered.map((t) => {
            const up = t.priceChangePercent >= 0;
            const color = up ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';
            const coin = coinOf(t.symbol);
            return (
              <div
                key={t.symbol}
                className="group flex shrink-0 items-center gap-2 px-3.5 py-2 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-[var(--bg-secondary-20)]"
              >
                <span className="flex items-center gap-1.5">
                  <CoinIcon symbol={t.symbol} size={14} />
                  <span className="font-sans text-[11px] font-semibold leading-none tracking-tight text-[var(--role-content)]">
                    {coin}
                  </span>
                </span>
                {/* Price tweens to its new value on each poll instead of
                    hard-snapping. formatPrice now emits a FIXED decimal count,
                    so with tabular-nums the width is stable through the tween —
                    no reflow, no tape shake, and no wasteful fixed-width slot. */}
                <span className="font-sans text-[11px] leading-none tabular-nums text-[var(--role-content-muted)]">
                  <AnimatedNumber value={t.lastPrice} format={formatPrice} />
                </span>
                {/* 24h change with a directional caret. Colour eases when it
                    crosses zero, so a market turning red/green fades not blinks. */}
                <span
                  className="inline-flex items-center gap-0.5 font-sans text-[11px] font-medium leading-none tabular-nums transition-colors duration-500 ease-[var(--ease-out)]"
                  style={{ color }}
                >
                  <span aria-hidden className="text-[9px] leading-none">{up ? '▲' : '▼'}</span>
                  {Math.abs(t.priceChangePercent).toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* Soft fades at both edges — content scrolls under them instead of
          hitting a hard border, cueing that the tape continues. */}
      <div className="pointer-events-none absolute inset-y-px left-px w-8 rounded-l-[var(--radius-sm)] bg-gradient-to-r from-[var(--role-surface)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-px right-px w-8 rounded-r-[var(--radius-sm)] bg-gradient-to-l from-[var(--role-surface)] to-transparent" />
    </div>
  );
}
