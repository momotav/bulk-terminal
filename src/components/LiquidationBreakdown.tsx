'use client';

// 24h liquidations, split by market and by side.
//
// Sits alongside Hall of Shame: that panel answers "who got liquidated",
// this one answers "where". Source is /api/analytics/liquidations/treemap,
// which returns one row per (symbol, side) pair; we fold those into a
// single row per symbol carrying both sides.
//
// The bar is a proportion, not a chart — long share vs short share of that
// market's total. Two flat segments in the existing signal colors, no axis,
// no legend beyond the header. At this size anything more would be noise.

import { useEffect, useState } from 'react';
import { formatCompact } from '@/lib/api';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';

interface TreemapRow {
  symbol: string;
  side: string;
  value: number;
  count: number;
}

interface MarketLiquidations {
  symbol: string;
  long: number;
  short: number;
  total: number;
  count: number;
}

interface LiquidationBreakdownProps {
  flush?: boolean;
}

export function LiquidationBreakdown({ flush = false }: LiquidationBreakdownProps) {
  const { network } = useCurrentNetwork();
  const [rows, setRows] = useState<MarketLiquidations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        const res = await fetch(
          `${API_URL}${withNetwork('/api/analytics/liquidations/treemap?period=24h')}`
        );
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;

        // Fold (symbol, side) rows into one entry per symbol.
        const bySymbol = new Map<string, MarketLiquidations>();
        for (const r of (json.data || []) as TreemapRow[]) {
          const key = String(r.symbol);
          const entry =
            bySymbol.get(key) ?? { symbol: key, long: 0, short: 0, total: 0, count: 0 };
          const value = Number(r.value) || 0;
          if (r.side === 'long') entry.long += value;
          else entry.short += value;
          entry.total += value;
          entry.count += Number(r.count) || 0;
          bySymbol.set(key, entry);
        }

        setRows([...bySymbol.values()].sort((a, b) => b.total - a.total));
        setLoading(false);
      } catch {
        // Silent — this panel is supplementary to Hall of Shame.
      }
    };

    fetchData();
    const tick = window.setInterval(fetchData, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [network]);

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className={`glass-card flex h-full flex-col ${flush ? 'panel-flush' : ''}`}>
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2 truncate">Liquidations by Market</h2>
          <p className="t-caption truncate">
            {loading ? 'Loading' : `$${formatCompact(grandTotal)} in 24h`}
          </p>
        </div>
        {/* Side key. Doubles as the legend for the bars below. */}
        {!loading && rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="t-label" style={{ color: 'var(--role-signal-positive)' }}>
              Long
            </span>
            <span className="t-label" style={{ color: 'var(--role-signal-negative)' }}>
              Short
            </span>
          </div>
        )}
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-3 p-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="mb-1.5 h-3 w-20 rounded bg-[var(--bg-secondary-20)]" />
                <div className="h-1.5 w-full rounded bg-[var(--bg-secondary-20)]" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <p className="t-body text-[var(--role-content-muted)]">No liquidations</p>
            <p className="t-caption mt-1">Nothing has been liquidated in the last 24 hours.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--role-line-subtle)]">
            {rows.map((r, i) => {
              const longPct = r.total > 0 ? (r.long / r.total) * 100 : 0;
              const shortPct = r.total > 0 ? (r.short / r.total) * 100 : 0;
              return (
                <div
                  key={r.symbol}
                  style={
                    {
                      '--row-accent': 'var(--role-signal-negative)',
                      '--row-index': i,
                    } as React.CSSProperties
                  }
                  className="data-row animate-row-enter px-4 py-2.5"
                >
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-xs font-medium text-[var(--role-content)]">
                      {r.symbol}
                    </span>
                    <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-[var(--role-content)]">
                      ${formatCompact(r.total)}
                    </span>
                  </div>

                  {/* Long / short proportion. Width is the only encoding —
                      no track background, which would read as a progress
                      bar rather than a split. */}
                  <div className="flex h-1.5 w-full overflow-hidden rounded-[1px]">
                    <div
                      style={{
                        width: `${longPct}%`,
                        backgroundColor: 'var(--role-signal-positive)',
                      }}
                      title={`Long $${formatCompact(r.long)}`}
                    />
                    <div
                      style={{
                        width: `${shortPct}%`,
                        backgroundColor: 'var(--role-signal-negative)',
                      }}
                      title={`Short $${formatCompact(r.short)}`}
                    />
                  </div>

                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="t-caption font-mono tabular-nums">
                      {longPct.toFixed(0)}% long
                    </span>
                    <span className="t-caption font-mono tabular-nums">
                      {r.count.toLocaleString()} events
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
