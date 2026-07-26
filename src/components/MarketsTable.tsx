'use client';

// Markets table — every active BULK market with its full 24h picture.
//
// This is the densest real content the dashboard has access to: 11 markets
// across 8 columns, all from one already-running poll. Columns drop
// progressively as the panel narrows rather than wrapping or scrolling,
// so the table stays readable from 1920px down to a phone.

import Link from 'next/link';
import { formatCompact } from '@/lib/api';
import { type BulkTicker, formatPrice, openInterestUsd } from '@/hooks/useTickers';

interface MarketsTableProps {
  tickers: BulkTicker[];
  loading: boolean;
  flush?: boolean;
}

// Funding is a per-interval rate; showing it as a percentage with 4 decimals
// matches how the exchange quotes it.
function formatFunding(rate: number): string {
  if (!Number.isFinite(rate)) return '--';
  return `${(rate * 100).toFixed(4)}%`;
}

export function MarketsTable({ tickers, loading, flush = false }: MarketsTableProps) {
  return (
    <div className={`glass-card flex h-full flex-col ${flush ? 'panel-flush' : ''}`}>
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2 truncate">Markets</h2>
          <p className="t-caption truncate">
            {loading ? 'Loading' : `${tickers.length} active perps`}
          </p>
        </div>
        <Link
          href="/analytics/general"
          className="group inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[var(--role-content-muted)] transition-colors hover:text-[var(--role-content)]"
        >
          Analytics
          <span
            aria-hidden
            className="transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      </div>

      {/* Column header */}
      {!loading && tickers.length > 0 && (
        <div className="flex items-center gap-3 border-b border-[var(--role-line-subtle)] bg-[var(--role-background)]/40 px-5 py-2">
          {/* Column priority, widest breakpoint last to disappear:
              Market / Last / 24h always → Volume + OI at lg → Funding at
              xl → High + Low at 2xl. Funding outranks the daily range
              because it is the number worth glancing at. */}
          <span className="table-header flex-1">Market</span>
          <span className="table-header w-24 text-right">Last</span>
          <span className="table-header w-20 text-right">24h</span>
          <span className="table-header hidden w-24 text-right 2xl:block">High</span>
          <span className="table-header hidden w-24 text-right 2xl:block">Low</span>
          <span className="table-header hidden w-24 text-right lg:block">Volume</span>
          <span className="table-header hidden w-24 text-right lg:block">OI</span>
          <span className="table-header hidden w-24 text-right xl:block">Funding</span>
        </div>
      )}

      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 p-2">
                <div className="h-3 w-24 rounded bg-[var(--bg-secondary-20)]" />
                <div className="ml-auto h-3 w-20 rounded bg-[var(--bg-secondary-20)]" />
                <div className="h-3 w-14 rounded bg-[var(--bg-secondary-20)]" />
              </div>
            ))}
          </div>
        ) : tickers.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="t-body text-[var(--role-content-muted)]">No markets available</p>
            <p className="t-caption mt-1">The exchange feed is not reporting any active perps.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--role-line-subtle)]">
            {tickers.map((t, i) => {
              const up = t.priceChangePercent >= 0;
              const signal = up ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';
              return (
                <div
                  key={t.symbol}
                  style={
                    { '--row-accent': signal, '--row-index': i } as React.CSSProperties
                  }
                  className="data-row animate-row-enter flex items-center gap-3 px-5 py-3"
                >
                  {/* Market */}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium tracking-tight text-[var(--role-content)]">
                    {t.symbol}
                  </span>

                  {/* Last price */}
                  <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--role-content)]">
                    {formatPrice(t.lastPrice)}
                  </span>

                  {/* 24h change */}
                  <span
                    className="w-20 shrink-0 text-right font-mono text-xs font-medium tabular-nums"
                    style={{ color: signal }}
                  >
                    {up ? '+' : ''}
                    {t.priceChangePercent.toFixed(2)}%
                  </span>

                  {/* 24h high / low — first to go when width runs out. */}
                  <span className="t-caption hidden w-24 shrink-0 text-right font-mono tabular-nums 2xl:block">
                    {formatPrice(t.highPrice)}
                  </span>
                  <span className="t-caption hidden w-24 shrink-0 text-right font-mono tabular-nums 2xl:block">
                    {formatPrice(t.lowPrice)}
                  </span>

                  {/* Quote volume */}
                  <span className="t-caption hidden w-24 shrink-0 text-right font-mono tabular-nums lg:block">
                    ${formatCompact(t.quoteVolume)}
                  </span>

                  {/* Open interest, converted from base coin to USD notional */}
                  <span className="t-caption hidden w-24 shrink-0 text-right font-mono tabular-nums lg:block">
                    ${formatCompact(openInterestUsd(t))}
                  </span>

                  {/* Funding — outranks High/Low, survives down to xl. */}
                  <span
                    className="hidden w-24 shrink-0 text-right font-mono text-[11px] tabular-nums xl:block"
                    style={{
                      color:
                        t.fundingRate >= 0
                          ? 'var(--role-content-subtle)'
                          : 'var(--role-signal-negative)',
                    }}
                  >
                    {formatFunding(t.fundingRate)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
