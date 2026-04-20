'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analytics, formatCompact, cn, type OrderbookSnapshot } from '@/lib/api';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ----------------------------------------------------------------------------
// Constants & helpers
// ----------------------------------------------------------------------------

const MARKETS = ['BTC-USD', 'ETH-USD', 'SOL-USD'] as const;
type Market = (typeof MARKETS)[number];

const COLORS = {
  bid: '#00B481', // green
  ask: '#EF4A3C', // red
  mid: 'var(--text-secondary)',
};

// Auto-refresh every 3 seconds. Backend caches for 2s, so worst case we hit
// BULK once per user per 3s refresh — fine for page-level use.
const REFRESH_INTERVAL_MS = 3000;

function formatPrice(px: number, coin: Market): string {
  // Use symbol-appropriate decimal places. BTC ticks at $0.50, ETH at $0.01
  // typically, SOL at $0.001. Best to just pick a reasonable display format
  // based on the magnitude of the price itself.
  if (px >= 1000) return px.toFixed(2);
  if (px >= 10) return px.toFixed(3);
  return px.toFixed(4);
}

function formatBps(bps: number | null): string {
  if (bps === null || !isFinite(bps)) return '—';
  return `${bps.toFixed(2)} bps`;
}

// ----------------------------------------------------------------------------
// Market selector pills
// ----------------------------------------------------------------------------

function MarketSelector({
  value,
  onChange,
}: {
  value: Market;
  onChange: (m: Market) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
      {MARKETS.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded transition-colors',
            value === m
              ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          {m.replace('-USD', '')}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Stat card
// ----------------------------------------------------------------------------

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'bid' | 'ask' | 'muted';
}) {
  const valueColor =
    accent === 'bid'
      ? 'text-[#00B481]'
      : accent === 'ask'
      ? 'text-[#EF4A3C]'
      : 'text-[var(--text-primary)]';
  return (
    <div className="bg-[var(--bg-base)] p-4">
      <p className="text-xs text-[var(--text-tertiary)] mb-1">{label}</p>
      <p className={cn('text-xl font-bold', valueColor)}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{sub}</p>}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Depth chart — "staircase" visualization of cumulative notional
// ----------------------------------------------------------------------------

type DepthPoint = { px: number; bid?: number; ask?: number };

function buildDepthSeries(ob: OrderbookSnapshot): DepthPoint[] {
  // Build two independent cumulative series (bid and ask) in a shared x-axis
  // by price. Bids cumulate from best (highest) down to worst (lowest).
  // Asks cumulate from best (lowest) up to worst (highest). We merge into
  // one sorted-by-price array for Recharts to draw both areas together.
  const bidPoints: DepthPoint[] = [];
  let bidCum = 0;
  for (const l of ob.bids) {
    bidCum += l.px * l.sz; // USD notional
    bidPoints.push({ px: l.px, bid: bidCum });
  }

  const askPoints: DepthPoint[] = [];
  let askCum = 0;
  for (const l of ob.asks) {
    askCum += l.px * l.sz;
    askPoints.push({ px: l.px, ask: askCum });
  }

  // Merge and sort ascending by price for charting.
  const all = [...bidPoints, ...askPoints].sort((a, b) => a.px - b.px);
  return all;
}

function DepthChart({ data, mid }: { data: DepthPoint[]; mid: number | null }) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
          <XAxis
            dataKey="px"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v) => formatCompact(v)}
            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
            axisLine={{ stroke: 'var(--border-color)' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `$${formatCompact(v)}`}
            tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
            axisLine={{ stroke: 'var(--border-color)' }}
            tickLine={false}
            width={60}
          />
          <Tooltip
            cursor={{ stroke: 'var(--text-secondary)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const p = payload[0].payload as DepthPoint;
              return (
                <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg px-3 py-2 shadow-xl">
                  <p className="text-xs text-[var(--text-tertiary)] mb-1">
                    price ${formatCompact(p.px)}
                  </p>
                  {typeof p.bid === 'number' && (
                    <p className="text-sm">
                      <span className="text-[#00B481]">●</span> bid cum ${formatCompact(p.bid)}
                    </p>
                  )}
                  {typeof p.ask === 'number' && (
                    <p className="text-sm">
                      <span className="text-[#EF4A3C]">●</span> ask cum ${formatCompact(p.ask)}
                    </p>
                  )}
                </div>
              );
            }}
          />
          {mid !== null && (
            <ReferenceLine
              x={mid}
              stroke={COLORS.mid}
              strokeDasharray="3 3"
              label={{ value: 'mid', position: 'top', fill: 'var(--text-secondary)', fontSize: 10 }}
            />
          )}
          <Area
            type="stepAfter"
            dataKey="bid"
            stroke={COLORS.bid}
            fill={COLORS.bid}
            fillOpacity={0.25}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Area
            type="stepBefore"
            dataKey="ask"
            stroke={COLORS.ask}
            fill={COLORS.ask}
            fillOpacity={0.25}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Bid/Ask ladder — classic order book display with fill bars
// ----------------------------------------------------------------------------

function Ladder({
  title,
  side,
  levels,
  coin,
}: {
  title: string;
  side: 'bid' | 'ask';
  levels: { px: number; sz: number; n: number }[];
  coin: Market;
}) {
  // Normalize size into a percentage fill so we can draw a background bar
  // proportional to liquidity at each level.
  const maxSz = Math.max(1e-9, ...levels.map((l) => l.sz));
  const bgColor = side === 'bid' ? 'rgba(0, 180, 129, 0.15)' : 'rgba(239, 74, 60, 0.15)';
  const pxColor = side === 'bid' ? 'text-[#00B481]' : 'text-[#EF4A3C]';

  return (
    <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-[var(--text-primary)]">{title}</h4>
        <span className="text-xs text-[var(--text-tertiary)]">{levels.length} levels</span>
      </div>
      <div className="grid grid-cols-3 text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 px-2">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Orders</span>
      </div>
      <div className="space-y-[1px]">
        {levels.map((l, i) => {
          const pct = (l.sz / maxSz) * 100;
          const fillStyle = side === 'bid'
            ? { background: `linear-gradient(to left, ${bgColor} ${pct}%, transparent ${pct}%)` }
            : { background: `linear-gradient(to right, ${bgColor} ${pct}%, transparent ${pct}%)` };
          return (
            <div
              key={`${side}-${i}-${l.px}`}
              className="grid grid-cols-3 px-2 py-1 text-xs rounded"
              style={fillStyle}
            >
              <span className={cn('font-mono', pxColor)}>{formatPrice(l.px, coin)}</span>
              <span className="text-right font-mono text-[var(--text-primary)]">
                {l.sz.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
              <span className="text-right font-mono text-[var(--text-tertiary)]">{l.n}</span>
            </div>
          );
        })}
        {levels.length === 0 && (
          <div className="text-xs text-[var(--text-tertiary)] text-center py-4">No levels</div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Main page
// ----------------------------------------------------------------------------

export default function OrderBookPage() {
  const [coin, setCoin] = useState<Market>('BTC-USD');
  const [book, setBook] = useState<OrderbookSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track only the INITIAL load per coin so we can show a loading state the
  // first time; subsequent refreshes silently update in place.
  const [initialLoading, setInitialLoading] = useState(true);
  const lastFetchedCoinRef = useRef<Market | null>(null);

  // Pull the current snapshot. Wrapped in useCallback so the polling useEffect
  // can depend on coin without re-declaring the function each render.
  const fetchBook = useCallback(async (target: Market, resetLoading: boolean) => {
    if (resetLoading) setInitialLoading(true);
    try {
      const snap = await analytics.getOrderbook(target, 20);
      // Guard against stale responses from a previous coin (e.g., user clicked
      // BTC → ETH quickly; BTC's response may resolve after ETH was selected).
      if (lastFetchedCoinRef.current !== target && lastFetchedCoinRef.current !== null) {
        return;
      }
      setBook(snap);
      setError(null);
    } catch (err) {
      console.error('Failed to load order book:', err);
      setError(err instanceof Error ? err.message : 'Failed to load order book');
    } finally {
      if (resetLoading) setInitialLoading(false);
    }
  }, []);

  // When coin changes, clear the old book immediately (so users see the
  // market selector respond) and kick off a fresh fetch with loading state.
  useEffect(() => {
    lastFetchedCoinRef.current = coin;
    setBook(null);
    fetchBook(coin, true);
  }, [coin, fetchBook]);

  // Polling — refresh every REFRESH_INTERVAL_MS while the page is open.
  useEffect(() => {
    const id = setInterval(() => {
      fetchBook(coin, false);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [coin, fetchBook]);

  const depthData = useMemo(() => (book ? buildDepthSeries(book) : []), [book]);

  const stats = book?.stats;
  const lastUpdated = book ? new Date(book.timestamp).toLocaleTimeString() : '—';

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Order Book</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Live market depth — auto-refreshes every 3 seconds · last update {lastUpdated}
          </p>
        </div>
        <MarketSelector value={coin} onChange={setCoin} />
      </div>

      {/* Error banner */}
      {error && !initialLoading && (
        <div className="bg-[#EF4A3C]/10 border border-[#EF4A3C]/30 text-[#EF4A3C] text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border-color)] rounded-lg overflow-hidden">
        <Stat
          label="Best Bid"
          value={stats?.bestBid ? `$${formatPrice(stats.bestBid.px, coin)}` : '—'}
          sub={stats?.bestBid ? `${stats.bestBid.sz.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ ${stats.bestBid.n} orders` : undefined}
          accent="bid"
        />
        <Stat
          label="Best Ask"
          value={stats?.bestAsk ? `$${formatPrice(stats.bestAsk.px, coin)}` : '—'}
          sub={stats?.bestAsk ? `${stats.bestAsk.sz.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ ${stats.bestAsk.n} orders` : undefined}
          accent="ask"
        />
        <Stat
          label="Spread"
          value={formatBps(stats?.spreadBps ?? null)}
          sub={stats?.spreadAbs != null ? `$${stats.spreadAbs.toFixed(4)}` : undefined}
        />
        <Stat
          label="Mid Price"
          value={stats?.mid != null ? `$${formatPrice(stats.mid, coin)}` : '—'}
        />
      </div>

      {/* Depth / imbalance row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-[var(--border-color)] rounded-lg overflow-hidden">
        <Stat
          label="Bid Depth (±2% of mid)"
          value={stats ? `$${formatCompact(stats.bidDepth2pctUsd)}` : '—'}
          accent="bid"
        />
        <Stat
          label="Ask Depth (±2% of mid)"
          value={stats ? `$${formatCompact(stats.askDepth2pctUsd)}` : '—'}
          accent="ask"
        />
        <Stat
          label="Book Imbalance"
          value={
            stats
              ? `${stats.imbalance >= 0 ? '+' : ''}${(stats.imbalance * 100).toFixed(1)}%`
              : '—'
          }
          sub={
            stats
              ? stats.imbalance > 0.05
                ? 'Bid-heavy'
                : stats.imbalance < -0.05
                ? 'Ask-heavy'
                : 'Balanced'
              : undefined
          }
          accent={stats && stats.imbalance > 0.05 ? 'bid' : stats && stats.imbalance < -0.05 ? 'ask' : 'muted'}
        />
      </div>

      {/* Depth chart */}
      <div className="bg-transparent rounded-lg border border-[var(--border-color)] p-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Depth Chart</h3>
        {initialLoading ? (
          <div className="h-[280px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
          </div>
        ) : book && depthData.length > 0 ? (
          <DepthChart data={depthData} mid={stats?.mid ?? null} />
        ) : (
          <div className="h-[280px] flex items-center justify-center text-sm text-[var(--text-tertiary)]">
            No depth data available.
          </div>
        )}
      </div>

      {/* Ladder */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {initialLoading ? (
          <>
            <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4 h-[420px] animate-pulse" />
            <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4 h-[420px] animate-pulse" />
          </>
        ) : book ? (
          <>
            <Ladder title="Bids" side="bid" levels={book.bids} coin={coin} />
            <Ladder title="Asks" side="ask" levels={book.asks} coin={coin} />
          </>
        ) : (
          <div className="col-span-full text-sm text-[var(--text-tertiary)] text-center py-8">
            No order book data.
          </div>
        )}
      </div>
    </div>
  );
}
