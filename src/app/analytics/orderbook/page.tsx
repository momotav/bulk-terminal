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
  bid: '#00B481',
  ask: '#EF4A3C',
  mid: 'var(--text-secondary)',
};

// Auto-refresh every 3 seconds. Backend caches for 2s.
const REFRESH_INTERVAL_MS = 3000;

// Locale-independent number formatting. Using en-US explicitly prevents the
// ".toLocaleString()" bug where a German/Russian/Ukrainian browser would render
// "23,2435" instead of "23.2435" because comma is their decimal separator.
function formatPrice(px: number): string {
  // Decimal places vary by magnitude — SOL needs 4 dp, BTC wants 2 dp.
  let decimals = 2;
  if (px < 10) decimals = 4;
  else if (px < 1000) decimals = 3;
  return px.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatSize(sz: number): string {
  // Sizes like "4.57" BTC or "108,548.65" SOL — up to 4 decimals, thousands sep.
  return sz.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatBps(bps: number | null): string {
  if (bps === null || !isFinite(bps)) return '—';
  return `${bps.toFixed(2)}`;
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
// Stat card — cleaner hierarchy, subtle border, tabular nums
// ----------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  unit,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Small unit text rendered after the value (e.g. "bps"). */
  unit?: string;
  accent?: 'bid' | 'ask' | 'muted';
}) {
  const valueColor =
    accent === 'bid'
      ? 'text-[#00B481]'
      : accent === 'ask'
      ? 'text-[#EF4A3C]'
      : 'text-[var(--text-primary)]';
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-4 transition-colors">
      <p className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium mb-2">
        {label}
      </p>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('text-2xl font-bold tabular-nums tracking-tight', valueColor)}>
          {value}
        </span>
        {unit && (
          <span className="text-sm text-[var(--text-tertiary)] font-medium">{unit}</span>
        )}
      </div>
      {sub && (
        <p className="text-xs text-[var(--text-tertiary)] mt-1.5 tabular-nums">{sub}</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Depth chart — staircase visualization of cumulative notional
// ----------------------------------------------------------------------------

type DepthPoint = { px: number; bid?: number; ask?: number };

function buildDepthSeries(ob: OrderbookSnapshot): DepthPoint[] {
  const bidPoints: DepthPoint[] = [];
  let bidCum = 0;
  for (const l of ob.bids) {
    bidCum += l.px * l.sz;
    bidPoints.push({ px: l.px, bid: bidCum });
  }

  const askPoints: DepthPoint[] = [];
  let askCum = 0;
  for (const l of ob.asks) {
    askCum += l.px * l.sz;
    askPoints.push({ px: l.px, ask: askCum });
  }

  return [...bidPoints, ...askPoints].sort((a, b) => a.px - b.px);
}

/**
 * Custom "mid price" indicator — dashed vertical line with a pill badge at top.
 * Replaces Recharts' default `label` prop which renders unstyled text.
 */
function MidPriceIndicator(props: any) {
  const { viewBox, midValue } = props;
  if (!viewBox || midValue == null) return null;
  const { x, y, height } = viewBox;
  const lineX = x;
  const badgeText = `Mid  $${formatPrice(midValue)}`;
  const badgeWidth = Math.max(90, 7.2 * badgeText.length + 16);
  const badgeHeight = 20;
  const badgeY = y - 2;
  const badgeX = lineX - badgeWidth / 2;

  return (
    <g>
      <line
        x1={lineX}
        y1={y}
        x2={lineX}
        y2={y + height}
        stroke="var(--text-secondary)"
        strokeDasharray="3 3"
        strokeWidth={1}
        opacity={0.5}
      />
      <rect
        x={badgeX}
        y={badgeY}
        width={badgeWidth}
        height={badgeHeight}
        rx={badgeHeight / 2}
        ry={badgeHeight / 2}
        fill="var(--bg-muted)"
        stroke="var(--border-color)"
        strokeWidth={1}
      />
      <text
        x={lineX}
        y={badgeY + badgeHeight / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fill="var(--text-primary)"
        style={{ fontFamily: 'inherit', fontWeight: 500 }}
      >
        {badgeText}
      </text>
    </g>
  );
}

function DepthChart({ data, mid }: { data: DepthPoint[]; mid: number | null }) {
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 28, right: 10, bottom: 5, left: 10 }}>
          <defs>
            {/* Soft vertical gradients give a more premium feel than flat fills */}
            <linearGradient id="bidGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.bid} stopOpacity={0.4} />
              <stop offset="100%" stopColor={COLORS.bid} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="askGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.ask} stopOpacity={0.4} />
              <stop offset="100%" stopColor={COLORS.ask} stopOpacity={0.05} />
            </linearGradient>
          </defs>
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
            cursor={{ stroke: 'var(--text-secondary)', strokeDasharray: '3 3', strokeOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const p = payload[0].payload as DepthPoint;
              return (
                <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg px-3 py-2 shadow-xl min-w-[180px]">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5 font-medium">
                    price ${formatPrice(p.px)}
                  </p>
                  {typeof p.bid === 'number' && (
                    <p className="text-sm flex items-center gap-2 tabular-nums">
                      <span className="inline-block w-2 h-2 rounded-full bg-[#00B481]" />
                      <span className="text-[var(--text-tertiary)]">bids</span>
                      <span className="text-[var(--text-primary)] font-medium ml-auto">
                        ${formatCompact(p.bid)}
                      </span>
                    </p>
                  )}
                  {typeof p.ask === 'number' && (
                    <p className="text-sm flex items-center gap-2 tabular-nums">
                      <span className="inline-block w-2 h-2 rounded-full bg-[#EF4A3C]" />
                      <span className="text-[var(--text-tertiary)]">asks</span>
                      <span className="text-[var(--text-primary)] font-medium ml-auto">
                        ${formatCompact(p.ask)}
                      </span>
                    </p>
                  )}
                </div>
              );
            }}
          />
          {mid !== null && (
            <ReferenceLine x={mid} shape={(props: any) => <MidPriceIndicator {...props} midValue={mid} />} />
          )}
          <Area
            type="stepAfter"
            dataKey="bid"
            stroke={COLORS.bid}
            fill="url(#bidGradient)"
            strokeWidth={2}
            connectNulls={false}
            // Animate duration tuned to feel smooth but not distracting when
            // the book updates every 3 seconds. Default is 1500ms which looks
            // like a re-draw; 600ms is fast-smooth.
            isAnimationActive={true}
            animationDuration={600}
            animationEasing="ease-out"
          />
          <Area
            type="stepBefore"
            dataKey="ask"
            stroke={COLORS.ask}
            fill="url(#askGradient)"
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={true}
            animationDuration={600}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Bid/Ask ladder
// ----------------------------------------------------------------------------

function Ladder({
  title,
  side,
  levels,
}: {
  title: string;
  side: 'bid' | 'ask';
  levels: { px: number; sz: number; n: number }[];
}) {
  const maxSz = Math.max(1e-9, ...levels.map((l) => l.sz));
  const bgColor = side === 'bid' ? 'rgba(0, 180, 129, 0.15)' : 'rgba(239, 74, 60, 0.15)';
  const pxColor = side === 'bid' ? 'text-[#00B481]' : 'text-[#EF4A3C]';

  return (
    <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-[var(--text-primary)]">{title}</h4>
        <span className="text-xs text-[var(--text-tertiary)]">{levels.length} levels</span>
      </div>
      <div className="grid grid-cols-3 text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider mb-1 px-2 font-medium">
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
              className="grid grid-cols-3 px-2 py-1 text-xs rounded tabular-nums"
              style={fillStyle}
            >
              <span className={cn('font-mono', pxColor)}>{formatPrice(l.px)}</span>
              <span className="text-right font-mono text-[var(--text-primary)]">
                {formatSize(l.sz)}
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
  const [initialLoading, setInitialLoading] = useState(true);
  const lastFetchedCoinRef = useRef<Market | null>(null);

  const fetchBook = useCallback(async (target: Market, resetLoading: boolean) => {
    if (resetLoading) setInitialLoading(true);
    try {
      const snap = await analytics.getOrderbook(target, 20);
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

  useEffect(() => {
    lastFetchedCoinRef.current = coin;
    setBook(null);
    fetchBook(coin, true);
  }, [coin, fetchBook]);

  useEffect(() => {
    const id = setInterval(() => {
      fetchBook(coin, false);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [coin, fetchBook]);

  const depthData = useMemo(() => (book ? buildDepthSeries(book) : []), [book]);
  const stats = book?.stats;
  const lastUpdated = book ? new Date(book.timestamp).toLocaleTimeString() : '—';

  const imbalanceLabel = stats
    ? stats.imbalance > 0.05
      ? 'Bid-heavy'
      : stats.imbalance < -0.05
      ? 'Ask-heavy'
      : 'Balanced'
    : undefined;
  const imbalanceAccent: 'bid' | 'ask' | 'muted' | undefined = stats
    ? stats.imbalance > 0.05
      ? 'bid'
      : stats.imbalance < -0.05
      ? 'ask'
      : 'muted'
    : undefined;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Order Book</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1 tabular-nums">
            Live market depth · auto-refreshes every 3s · last update {lastUpdated}
          </p>
        </div>
        <MarketSelector value={coin} onChange={setCoin} />
      </div>

      {error && !initialLoading && (
        <div className="bg-[#EF4A3C]/10 border border-[#EF4A3C]/30 text-[#EF4A3C] text-sm rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* All 7 stats in a single aligned grid so column boundaries line up
          neatly and there are no visual "jumps" between rows. On large screens
          the top row has 4 cards and the bottom row has the remaining 3 —
          same column widths, same gaps, consistent rhythm. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Best Bid"
          value={stats?.bestBid ? `$${formatPrice(stats.bestBid.px)}` : '—'}
          sub={stats?.bestBid ? `${formatSize(stats.bestBid.sz)} · ${stats.bestBid.n} orders` : undefined}
          accent="bid"
        />
        <StatCard
          label="Best Ask"
          value={stats?.bestAsk ? `$${formatPrice(stats.bestAsk.px)}` : '—'}
          sub={stats?.bestAsk ? `${formatSize(stats.bestAsk.sz)} · ${stats.bestAsk.n} orders` : undefined}
          accent="ask"
        />
        <StatCard
          label="Spread"
          value={formatBps(stats?.spreadBps ?? null)}
          unit="bps"
          sub={stats?.spreadAbs != null ? `$${stats.spreadAbs.toFixed(4)}` : undefined}
        />
        <StatCard
          label="Mid Price"
          value={stats?.mid != null ? `$${formatPrice(stats.mid)}` : '—'}
          // Invisible spacer so this card matches the others' height. Using a
          // non-breaking space keeps the DOM consistent without rendering
          // anything visible, and tabular-nums ensures spacing is identical.
          sub={'\u00A0'}
        />
        <StatCard
          label="Bid Depth · ±2% of mid"
          value={stats ? `$${formatCompact(stats.bidDepth2pctUsd)}` : '—'}
          sub={'\u00A0'}
          accent="bid"
        />
        <StatCard
          label="Ask Depth · ±2% of mid"
          value={stats ? `$${formatCompact(stats.askDepth2pctUsd)}` : '—'}
          sub={'\u00A0'}
          accent="ask"
        />
        <StatCard
          label="Book Imbalance"
          value={stats ? `${stats.imbalance >= 0 ? '+' : ''}${(stats.imbalance * 100).toFixed(1)}%` : '—'}
          sub={imbalanceLabel ?? '\u00A0'}
          accent={imbalanceAccent}
        />
      </div>

      {/* Depth chart */}
      <div className="bg-transparent rounded-lg border border-[var(--border-color)] p-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Depth Chart</h3>
        {initialLoading ? (
          <div className="h-[320px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
          </div>
        ) : book && depthData.length > 0 ? (
          <DepthChart data={depthData} mid={stats?.mid ?? null} />
        ) : (
          <div className="h-[320px] flex items-center justify-center text-sm text-[var(--text-tertiary)]">
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
            <Ladder title="Bids" side="bid" levels={book.bids} />
            <Ladder title="Asks" side="ask" levels={book.asks} />
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
