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
    <div className="scrollbar-hide overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)]">
      <div className="flex items-center divide-x divide-[var(--role-line-subtle)]">
        {ordered.map((t) => {
          const up = t.priceChangePercent >= 0;
          const color = up ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';
          return (
            <div
              key={t.symbol}
              className="flex shrink-0 items-baseline gap-2 px-3 py-2 transition-colors duration-200 hover:bg-[var(--bg-secondary-20)]"
            >
              <span className="font-mono text-[11px] font-medium tracking-tight text-[var(--role-content)]">
                {t.symbol}
              </span>
              {/* Price tweens to its new value on each poll instead of
                  hard-snapping - the difference between a live feed and a
                  flicker. */}
              <span className="font-mono text-[11px] tabular-nums text-[var(--role-content-muted)]">
                <AnimatedNumber value={t.lastPrice} format={formatPrice} />
              </span>
              {/* Colour eases when 24h change crosses zero, so a market
                  turning red/green fades rather than blinks. */}
              <span
                className="font-mono text-[11px] font-medium tabular-nums transition-colors duration-500 ease-[var(--ease-out)]"
                style={{ color }}
              >
                {up ? '+' : ''}
                {t.priceChangePercent.toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
