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
import { ChevronDown } from 'lucide-react';
import { useAvailableCoins } from '@/hooks/useAvailableCoins';
import { DEFAULT_COINS } from '@/lib/coins';

// ----------------------------------------------------------------------------
// Constants & helpers
// ----------------------------------------------------------------------------

// Market identifier is any string from BULK's /exchangeInfo (e.g. "BTC-USD",
// "DOGE-USD", "FARTCOIN-USD"). The old `MARKETS = ['BTC-USD', 'ETH-USD', 'SOL-USD']`
// const was removed — the full list is now fetched at runtime via the
// useAvailableCoins hook, so newly-listed BULK markets show up here
// automatically with no code changes.
type Market = string;

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
// Market selector: quick pills for BTC/ETH/SOL + dropdown for every other
// market BULK has listed. Mirrors the same UX pattern we use on the General
// page — defaults are always one click away, long tail lives behind the menu.
// ----------------------------------------------------------------------------

function MarketSelector({
  value,
  onChange,
}: {
  value: Market;
  onChange: (m: Market) => void;
}) {
  // Live list of every coin BULK has listed. Falls back to DEFAULT_COINS
  // if /exchangeInfo is unreachable (see useAvailableCoins for details).
  const { coins: allCoins } = useAvailableCoins();

  // Dropdown state + outside-click close.
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Extract the "coin" part of the selected symbol (e.g. "BTC-USD" → "BTC").
  const coinOf = (sym: string): string => sym.replace('-USD', '');
  const selectedCoin = coinOf(value);

  // The quick-pill row shows BTC/ETH/SOL *plus* the currently-selected coin if
  // it's not one of the defaults. That way if the user picks FARTCOIN from the
  // dropdown, FARTCOIN becomes a visible pill and stays there until they pick
  // something else — same pattern as the General page's coin selector.
  const pillCoins: string[] = [
    ...DEFAULT_COINS,
    ...(
      (DEFAULT_COINS as readonly string[]).includes(selectedCoin) ? [] : [selectedCoin]
    ),
  ];

  // Everything in the dropdown that isn't already a quick pill.
  const dropdownCoins = allCoins.filter(
    (c) => !(DEFAULT_COINS as readonly string[]).includes(c) && c !== selectedCoin
  );

  const pickCoin = (coin: string) => {
    onChange(`${coin}-USD`);
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Quick-click pills */}
      <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
        {pillCoins.map((coin) => {
          const sym = `${coin}-USD`;
          return (
            <button
              key={coin}
              onClick={() => onChange(sym)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded transition-colors',
                value === sym
                  ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {coin}
            </button>
          );
        })}
      </div>

      {/* Dropdown for the rest — only shown if there are additional markets
          beyond the defaults. Always visually distinct from the pills so the
          user understands the two affordances. */}
      {dropdownCoins.length > 0 && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
              'border border-[var(--border-color)] bg-[var(--bg-muted)]',
              'text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors'
            )}
          >
            More
            <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
          </button>

          {open && (
            <div className="absolute right-0 mt-1 min-w-[140px] max-h-64 overflow-y-auto z-20 bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg shadow-xl py-1">
              {dropdownCoins.map((coin) => (
                <button
                  key={coin}
                  onClick={() => pickCoin(coin)}
                  className="w-full text-left px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-base)] transition-colors"
                >
                  {coin}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// FlashingValue — briefly highlights when the value changes, then fades back.
//
// The effect is driven by tracking the previous value in a ref. On every render
// where the incoming value differs from the ref, we flip a `flash` state on
// for ~500ms (via setTimeout), which applies a colored background. When it
// times out we go back to neutral. The underlying text is unchanged — this is
// just a visual cue that "something updated" so the page doesn't feel dead
// while still being easy on the eyes.
// ----------------------------------------------------------------------------

function FlashingValue({
  value,
  className,
  accent,
}: {
  value: string;
  className?: string;
  /** Determines the flash color. 'auto' flashes neutral (amber); 'bid' green; 'ask' red. */
  accent?: 'bid' | 'ask' | 'auto';
}) {
  const prevRef = useRef<string>(value);
  const [flashing, setFlashing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Skip the flash on the very first render — only animate real changes.
    if (prevRef.current !== value) {
      setFlashing(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFlashing(false), 500);
      prevRef.current = value;
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value]);

  const flashBg =
    accent === 'bid'
      ? 'bg-[#00B481]/20'
      : accent === 'ask'
      ? 'bg-[#EF4A3C]/20'
      : 'bg-[var(--text-primary)]/10';

  return (
    <span
      className={cn(
        'inline-block rounded px-1 -mx-1 transition-colors duration-500 ease-out',
        flashing ? flashBg : 'bg-transparent',
        className
      )}
    >
      {value}
    </span>
  );
}

// ----------------------------------------------------------------------------
// StatCell — matches the "Total Trades / Total Volume" row on the General page.
// Cards have no individual border; they sit inside a single rounded container
// with gap-px producing hairline dividers between them.
// ----------------------------------------------------------------------------

function StatCell({
  label,
  value,
  sub,
  unit,
  accent,
  flashAccent,
}: {
  label: string;
  value: string;
  sub?: string;
  unit?: string;
  accent?: 'bid' | 'ask' | 'muted';
  /** Optional accent color for the flash animation — defaults to card accent. */
  flashAccent?: 'bid' | 'ask' | 'auto';
}) {
  const valueColor =
    accent === 'bid'
      ? 'text-[#00B481]'
      : accent === 'ask'
      ? 'text-[#EF4A3C]'
      : 'text-[var(--text-primary)]';
  const resolvedFlashAccent =
    flashAccent ?? (accent === 'bid' ? 'bid' : accent === 'ask' ? 'ask' : 'auto');

  return (
    <div className="bg-[var(--bg-base)] p-4">
      <p className="text-xs text-[var(--text-tertiary)] mb-1">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <FlashingValue
          value={value}
          accent={resolvedFlashAccent}
          className={cn('text-2xl font-bold tabular-nums tracking-tight', valueColor)}
        />
        {unit && (
          <span className="text-sm text-[var(--text-tertiary)] font-medium">{unit}</span>
        )}
      </div>
      {sub !== undefined && (
        <p className="text-xs text-[var(--text-tertiary)] mt-1 tabular-nums">{sub}</p>
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
  const pxColor = side === 'bid' ? 'text-[#00B481]' : 'text-[#EF4A3C]';
  const fillColor = side === 'bid' ? 'rgba(0, 180, 129, 0.15)' : 'rgba(239, 74, 60, 0.15)';

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
          // Use a stable key based on price so React reuses DOM nodes across
          // refreshes. When the same price row just has a new size, the <div>
          // persists and the fill bar's width animates via CSS transition
          // instead of snapping from one value to another.
          const rowKey = `${side}-${l.px}`;
          return (
            <div
              key={rowKey}
              className="relative grid grid-cols-3 px-2 py-1 text-xs rounded tabular-nums overflow-hidden"
            >
              {/* Fill bar — absolutely positioned so its width can animate
                  without affecting the grid layout. For bids, anchor to the
                  right (so it grows leftward); for asks, anchor to the left. */}
              <div
                className={cn(
                  'absolute inset-y-0 pointer-events-none transition-all duration-500 ease-out',
                  side === 'bid' ? 'right-0' : 'left-0'
                )}
                style={{ width: `${pct}%`, background: fillColor }}
              />
              <span className={cn('relative font-mono', pxColor)}>{formatPrice(l.px)}</span>
              <span className="relative text-right font-mono text-[var(--text-primary)]">
                {formatSize(l.sz)}
              </span>
              <span className="relative text-right font-mono text-[var(--text-tertiary)]">
                {l.n}
              </span>
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

      {/* Two stat grids stacked — same styling as the General page's stats row
          (touching cells, 1px hairline dividers, single rounded container).
          The top row has 4 cells (quote info), the bottom row has 3 cells
          (depth summary) stretched evenly to fill the full width. Keeping them
          as two grids lets the bottom cells grow into thirds instead of fourths,
          so there's no empty trailing cell. */}
      <div className="space-y-3">
        {/* Row 1 — price quote (4 cells) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--border-color)] rounded-lg overflow-hidden">
          <StatCell
            label="Best Bid"
            value={stats?.bestBid ? `$${formatPrice(stats.bestBid.px)}` : '—'}
            sub={stats?.bestBid ? `${formatSize(stats.bestBid.sz)} · ${stats.bestBid.n} orders` : '\u00A0'}
            accent="bid"
          />
          <StatCell
            label="Best Ask"
            value={stats?.bestAsk ? `$${formatPrice(stats.bestAsk.px)}` : '—'}
            sub={stats?.bestAsk ? `${formatSize(stats.bestAsk.sz)} · ${stats.bestAsk.n} orders` : '\u00A0'}
            accent="ask"
          />
          <StatCell
            label="Spread"
            value={formatBps(stats?.spreadBps ?? null)}
            unit="bps"
            sub={stats?.spreadAbs != null ? `$${stats.spreadAbs.toFixed(4)}` : '\u00A0'}
          />
          <StatCell
            label="Mid Price"
            value={stats?.mid != null ? `$${formatPrice(stats.mid)}` : '—'}
            sub={'\u00A0'}
          />
        </div>

        {/* Row 2 — depth summary (3 cells, stretched evenly) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--border-color)] rounded-lg overflow-hidden">
          <StatCell
            label="Bid Depth · ±2% of mid"
            value={stats ? `$${formatCompact(stats.bidDepth2pctUsd)}` : '—'}
            sub={'\u00A0'}
            accent="bid"
          />
          <StatCell
            label="Ask Depth · ±2% of mid"
            value={stats ? `$${formatCompact(stats.askDepth2pctUsd)}` : '—'}
            sub={'\u00A0'}
            accent="ask"
          />
          <StatCell
            label="Book Imbalance"
            value={stats ? `${stats.imbalance >= 0 ? '+' : ''}${(stats.imbalance * 100).toFixed(1)}%` : '—'}
            sub={imbalanceLabel ?? '\u00A0'}
            accent={imbalanceAccent}
          />
        </div>
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
