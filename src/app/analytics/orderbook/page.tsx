'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Customized,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analytics, formatCompact, cn, type OrderbookSnapshot, type OrderbookLevel } from '@/lib/api';
import { CoinPicker } from '@/components/CoinPicker';
import { StatCard as SharedStatCard } from '@/components/StatCard';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

// ----------------------------------------------------------------------------
// Constants & helpers
// ----------------------------------------------------------------------------

type Market = string;

// recharts sets stroke/fill as SVG presentation attributes; in this app those
// resolve var(--…) fine (the other analytics charts rely on it), so the depth
// chart uses the palette variables directly and follows palette/theme switches.
const BID = 'var(--pos)';
const ASK = 'var(--neg)';

const REFRESH_INTERVAL_MS = 3000;

function formatPrice(px: number): string {
  let decimals = 2;
  if (px < 10) decimals = 4;
  else if (px < 1000) decimals = 3;
  return px.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatSize(sz: number): string {
  return sz.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function formatBps(bps: number | null | undefined): string {
  if (bps == null || !isFinite(bps)) return '-';
  return bps.toFixed(2);
}

// Thin adapter around the shared <CoinPicker>: the orderbook API speaks full
// symbols ("BTC-USD") but CoinPicker's contract is bare coin names ("BTC").
function MarketSelector({ value, onChange }: { value: Market; onChange: (m: Market) => void }) {
  return (
    <CoinPicker
      value={value.replace('-USD', '')}
      onChange={(coin) => onChange(`${coin}-USD`)}
      ariaLabel="Select market for order book"
    />
  );
}

// ----------------------------------------------------------------------------
// FlashingValue — a subtle background pulse when the value changes, so a live
// feed reads as alive without being noisy. Tracks the previous value in a ref
// and flips a flag for ~500ms on a real change.
// ----------------------------------------------------------------------------

function FlashingValue({
  value,
  className,
  style,
  accent,
}: {
  value: string;
  className?: string;
  style?: CSSProperties;
  accent?: 'bid' | 'ask' | 'auto';
}) {
  const prevRef = useRef<string>(value);
  const [flashing, setFlashing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
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

  const flashBg = !flashing
    ? 'transparent'
    : accent === 'bid'
    ? 'rgb(var(--pos-rgb) / 0.16)'
    : accent === 'ask'
    ? 'rgb(var(--neg-rgb) / 0.16)'
    : 'var(--bg-secondary-20)';

  return (
    <span
      className={cn('-mx-1 inline-block rounded px-1 transition-colors duration-500 ease-out', className)}
      style={{ ...style, backgroundColor: flashBg }}
    >
      {value}
    </span>
  );
}

// ----------------------------------------------------------------------------
// StatCard — flat KPI card matching the dashboard's stat row.
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
  unit?: string;
  accent?: 'bid' | 'ask';
}) {
  // Delegates to the shared StatCard so the orderbook KPIs match every other
  // page, while keeping this page's extras: a flash-on-change and a bid/ask
  // value tint. FlashingValue carries no typography of its own, so it inherits
  // the shared card's mono-26 treatment.
  const color = accent === 'bid' ? 'var(--pos)' : accent === 'ask' ? 'var(--neg)' : undefined;
  const flashAccent = accent === 'bid' ? 'bid' : accent === 'ask' ? 'ask' : 'auto';
  return (
    <SharedStatCard
      label={label}
      valueColor={color}
      unit={unit}
      sub={sub ?? ' '}
      value={<FlashingValue value={value} accent={flashAccent} />}
    />
  );
}

// ----------------------------------------------------------------------------
// Depth chart — cumulative-notional staircase, recharts, in a clean panel.
// ----------------------------------------------------------------------------

type DepthPoint = { px: number; bid?: number; ask?: number };

function buildDepthSeries(ob: OrderbookSnapshot): DepthPoint[] {
  const points: DepthPoint[] = [];
  let bidCum = 0;
  for (const l of ob.bids) {
    bidCum += l.px * l.sz;
    points.push({ px: l.px, bid: bidCum });
  }
  let askCum = 0;
  for (const l of ob.asks) {
    askCum += l.px * l.sz;
    points.push({ px: l.px, ask: askCum });
  }
  return points.sort((a, b) => a.px - b.px);
}

type MidGeom = { x: number; top: number; height: number };

// Reads the EXACT plot geometry recharts computed (x-scale + plot offset) for
// the mid price, and hands it up via `onGeom`. recharts strips inline styles
// off Customized SVG output, so instead of drawing the marker in the chart we
// use this only to measure, then render the marker as a DOM overlay whose CSS
// transform transitions smoothly. setState is deferred to a microtask so it
// never fires during recharts' render, and guarded so identical geometry
// doesn't loop.
function MidGeomReader({ xAxisMap, offset, mid, onGeom }: any) {
  const key = xAxisMap ? Object.keys(xAxisMap)[0] : null;
  const scale = key ? xAxisMap[key]?.scale : null;
  if (scale && offset && mid != null) {
    const x = scale(mid);
    if (typeof x === 'number' && isFinite(x)) {
      const g: MidGeom = { x, top: offset.top, height: offset.height };
      // rAF (not a microtask) so the setState lands between frames, fully
      // outside React's render phase — no "update while rendering" warning.
      requestAnimationFrame(() =>
        onGeom((prev: MidGeom | null) =>
          prev && prev.x === g.x && prev.top === g.top && prev.height === g.height ? prev : g
        )
      );
    }
  }
  return null;
}

type LevelPoint = { px: number; bid?: number; ask?: number };

function DepthChartPanel({ book, mid }: { book: OrderbookSnapshot; mid: number | null }) {
  const [view, setView] = useState<'depth' | 'levels'>('depth');
  const [midGeom, setMidGeom] = useState<MidGeom | null>(null);

  const depthData = useMemo(() => buildDepthSeries(book), [book]);
  // Per-price-level size (not cumulative), one point per level, split by side.
  const levelData = useMemo<LevelPoint[]>(
    () =>
      [
        ...book.bids.map((l) => ({ px: l.px, bid: l.sz })),
        ...book.asks.map((l) => ({ px: l.px, ask: l.sz })),
      ].sort((a, b) => a.px - b.px),
    [book]
  );

  const axisTick = { fill: 'var(--role-content-subtle)', fontSize: 10 };

  return (
    <div className="glass-card flex h-full flex-col">
      <div className="panel-header">
        <h2 className="panel-title t-h2">Market depth</h2>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 md:flex">
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--role-content-muted)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--pos)' }} /> Bids
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--role-content-muted)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--neg)' }} /> Asks
            </span>
          </div>
          {/* Chart type toggle: cumulative depth vs per-level liquidity bars. */}
          <div className="toggle-group">
            <button onClick={() => setView('depth')} className={cn('toggle-btn', view === 'depth' && 'active')}>Depth</button>
            <button onClick={() => setView('levels')} className={cn('toggle-btn', view === 'levels' && 'active')}>Levels</button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-2 py-3">
        {view === 'depth' ? (
          <div className="relative h-full w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={depthData} margin={{ top: 26, right: 8, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="ob-bid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BID} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={BID} stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="ob-ask" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ASK} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={ASK} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <XAxis dataKey="px" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => formatCompact(v)} tick={axisTick} axisLine={{ stroke: 'var(--role-line)' }} tickLine={false} />
              <YAxis tickFormatter={(v) => `$${formatCompact(v)}`} tick={axisTick} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                cursor={{ stroke: 'var(--role-content-subtle)', strokeDasharray: '3 3', strokeOpacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const p = payload[0].payload as DepthPoint;
                  return (
                    <div className="min-w-[170px] rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)] px-3 py-2 shadow-[var(--shadow-lg)]">
                      <p className="mb-1.5 font-mono text-[11px] text-[var(--role-content-subtle)]">Price ${formatPrice(p.px)}</p>
                      {typeof p.bid === 'number' && (
                        <p className="flex items-center gap-2 font-mono text-xs tabular-nums">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--pos)' }} />
                          <span className="text-[var(--role-content-muted)]">Bids</span>
                          <span className="ml-auto font-medium text-[var(--role-content)]">${formatCompact(p.bid)}</span>
                        </p>
                      )}
                      {typeof p.ask === 'number' && (
                        <p className="flex items-center gap-2 font-mono text-xs tabular-nums">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--neg)' }} />
                          <span className="text-[var(--role-content-muted)]">Asks</span>
                          <span className="ml-auto font-medium text-[var(--role-content)]">${formatCompact(p.ask)}</span>
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              {mid !== null && <Customized component={(p: any) => <MidGeomReader {...p} mid={mid} onGeom={setMidGeom} />} />}
              <Area type="stepAfter" dataKey="bid" stroke={BID} fill="url(#ob-bid)" strokeWidth={1.75} connectNulls={false} isAnimationActive animationDuration={500} animationEasing="ease-out" />
              <Area type="stepBefore" dataKey="ask" stroke={ASK} fill="url(#ob-ask)" strokeWidth={1.75} connectNulls={false} isAnimationActive animationDuration={500} animationEasing="ease-out" />
            </AreaChart>
          </ResponsiveContainer>
          {/* Mid-price marker as a DOM overlay — its transform CSS-transitions,
              so on each update it glides to the new mid instead of snapping. */}
          {midGeom && mid !== null && (
            <div
              className="pointer-events-none absolute left-0 top-0"
              style={{ transform: `translateX(${midGeom.x}px)`, transition: 'transform 550ms cubic-bezier(0.22,0.61,0.36,1)' }}
            >
              <div
                className="absolute border-l border-dashed border-[var(--role-content-subtle)] opacity-60"
                style={{ top: midGeom.top, height: midGeom.height }}
              />
              <div
                className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] font-semibold text-[var(--role-content-muted)]"
                style={{ top: midGeom.top - 17 }}
              >
                Mid ${formatPrice(mid)}
              </div>
            </div>
          )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={levelData} margin={{ top: 12, right: 8, bottom: 4, left: 4 }}>
              <XAxis dataKey="px" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => formatCompact(v)} tick={axisTick} axisLine={{ stroke: 'var(--role-line)' }} tickLine={false} />
              <YAxis tickFormatter={(v) => formatCompact(v)} tick={axisTick} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                cursor={{ fill: 'var(--bg-secondary-20)' }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const p = payload[0].payload as LevelPoint;
                  const side = typeof p.bid === 'number' ? 'bid' : 'ask';
                  const sz = side === 'bid' ? p.bid! : p.ask!;
                  return (
                    <div className="min-w-[150px] rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)] px-3 py-2 shadow-[var(--shadow-lg)]">
                      <p className="mb-1.5 font-mono text-[11px] text-[var(--role-content-subtle)]">Price ${formatPrice(p.px)}</p>
                      <p className="flex items-center gap-2 font-mono text-xs tabular-nums">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: side === 'bid' ? 'var(--pos)' : 'var(--neg)' }} />
                        <span className="text-[var(--role-content-muted)]">Size</span>
                        <span className="ml-auto font-medium text-[var(--role-content)]">{formatSize(sz)}</span>
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="bid" fill={BID} fillOpacity={0.8} isAnimationActive={false} />
              <Bar dataKey="ask" fill={ASK} fillOpacity={0.8} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Order book — one panel, bids | asks coupled, spread strip up top.
// ----------------------------------------------------------------------------

function withCumulative(levels: OrderbookLevel[]): { px: number; sz: number; n: number; cum: number }[] {
  let cum = 0;
  return levels.map((l) => {
    cum += l.sz;
    return { ...l, cum };
  });
}

function LadderColumn({ side, rows, maxSz }: { side: 'bid' | 'ask'; rows: ReturnType<typeof withCumulative>; maxSz: number }) {
  const pxColor = side === 'bid' ? 'var(--pos)' : 'var(--neg)';
  const fill = side === 'bid' ? 'rgb(var(--pos-rgb) / 0.14)' : 'rgb(var(--neg-rgb) / 0.14)';
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 pb-1.5 pt-2">
        <span className="table-header">Price</span>
        <span className="table-header text-right">Size</span>
        <span className="table-header w-16 text-right">Total</span>
      </div>
      <div>
        {rows.map((l) => {
          const pct = (l.sz / maxSz) * 100;
          return (
            <div key={`${side}-${l.px}`} className="relative grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-[3px] font-mono text-xs tabular-nums">
              <div
                className={cn('pointer-events-none absolute inset-y-px transition-[width] duration-500 ease-out', side === 'bid' ? 'right-0' : 'left-0')}
                style={{ width: `${pct}%`, background: fill }}
              />
              <span className="relative font-medium" style={{ color: pxColor }}>{formatPrice(l.px)}</span>
              <span className="relative text-right text-[var(--role-content)]">{formatSize(l.sz)}</span>
              <span className="relative w-16 text-right text-[var(--role-content-subtle)]">{formatSize(l.cum)}</span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="py-6 text-center text-[11px] text-[var(--role-content-subtle)]">No levels</div>
        )}
      </div>
    </div>
  );
}

function OrderBookPanel({
  book,
  levels = 14,
}: {
  book: OrderbookSnapshot;
  levels?: number;
}) {
  const stats = book.stats;
  const bids = useMemo(() => withCumulative(book.bids.slice(0, levels)), [book.bids, levels]);
  const asks = useMemo(() => withCumulative(book.asks.slice(0, levels)), [book.asks, levels]);
  const maxSz = Math.max(1e-9, ...bids.map((l) => l.sz), ...asks.map((l) => l.sz));

  const imb = stats.imbalance;
  const imbLabel = imb > 0.05 ? 'Bid-heavy' : imb < -0.05 ? 'Ask-heavy' : 'Balanced';
  const imbColor = imb > 0.05 ? 'var(--pos)' : imb < -0.05 ? 'var(--neg)' : 'var(--role-content-muted)';
  // Bid share of the visible top-of-book, for the header ratio bar.
  const bidShare = 50 + Math.max(-50, Math.min(50, imb * 50));

  return (
    <div className="glass-card flex h-full flex-col">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2 truncate">Order book</h2>
          <p className="t-caption truncate">{book.symbol}</p>
        </div>
        <span className="text-[11px] font-medium" style={{ color: imbColor }}>
          {imbLabel} {imb >= 0 ? '+' : ''}{(imb * 100).toFixed(1)}%
        </span>
      </div>

      {/* Imbalance ratio bar. */}
      <div className="flex h-1 w-full overflow-hidden">
        <div style={{ width: `${bidShare}%`, backgroundColor: 'rgb(var(--pos-rgb) / 0.55)' }} />
        <div style={{ width: `${100 - bidShare}%`, backgroundColor: 'rgb(var(--neg-rgb) / 0.55)' }} />
      </div>

      {/* Spread / mid strip. */}
      <div className="flex items-center justify-center gap-2.5 border-y border-[var(--role-line-subtle)] bg-[var(--role-background)]/40 py-1.5 font-mono text-[11px] tabular-nums">
        <span className="text-[var(--role-content-subtle)]">Spread</span>
        <span className="font-semibold text-[var(--role-content)]">{formatBps(stats.spreadBps)} bps</span>
        <span className="text-[var(--role-line)]">·</span>
        <span className="text-[var(--role-content-subtle)]">Mid</span>
        <span className="font-semibold text-[var(--role-content)]">{stats.mid != null ? `$${formatPrice(stats.mid)}` : '-'}</span>
      </div>

      {/* Coupled ladders. */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="grid grid-cols-2 divide-x divide-[var(--role-line-subtle)]">
          <LadderColumn side="bid" rows={bids} maxSz={maxSz} />
          <LadderColumn side="ask" rows={asks} maxSz={maxSz} />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function OrderBookPage() {
  const [coin, setCoin] = useState<Market>('BTC-USD');
  const { network } = useCurrentNetwork();
  const [book, setBook] = useState<OrderbookSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const lastFetchedCoinRef = useRef<Market | null>(null);

  const fetchBook = useCallback(async (target: Market, resetLoading: boolean) => {
    if (resetLoading) setInitialLoading(true);
    try {
      const snap = await analytics.getOrderbook(target, 20);
      if (lastFetchedCoinRef.current !== target && lastFetchedCoinRef.current !== null) return;
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
  }, [coin, fetchBook, network]);

  useEffect(() => {
    const id = setInterval(() => fetchBook(coin, false), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [coin, fetchBook, network]);

  const stats = book?.stats;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-medium leading-none tracking-tight text-[var(--role-content)] sm:text-[28px]">
          Order book
        </h1>
        <MarketSelector value={coin} onChange={setCoin} />
      </header>

      {error && !initialLoading && (
        <div className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm" style={{ borderColor: 'rgb(var(--neg-rgb) / 0.3)', backgroundColor: 'rgb(var(--neg-rgb) / 0.1)', color: 'var(--neg)' }}>
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Mid price" value={stats?.mid != null ? `$${formatPrice(stats.mid)}` : '-'} sub="Book midpoint" />
        <StatCard label="Spread" value={formatBps(stats?.spreadBps)} unit="bps" sub={stats?.spreadAbs != null ? `$${stats.spreadAbs.toFixed(4)}` : undefined} />
        <StatCard label="Best bid" value={stats?.bestBid ? `$${formatPrice(stats.bestBid.px)}` : '-'} sub={stats?.bestBid ? `${formatSize(stats.bestBid.sz)} · ${stats.bestBid.n} orders` : undefined} accent="bid" />
        <StatCard label="Best ask" value={stats?.bestAsk ? `$${formatPrice(stats.bestAsk.px)}` : '-'} sub={stats?.bestAsk ? `${formatSize(stats.bestAsk.sz)} · ${stats.bestAsk.n} orders` : undefined} accent="ask" />
        <StatCard label="Bid depth" value={stats ? `$${formatCompact(stats.bidDepth2pctUsd)}` : '-'} sub="±2% of mid" accent="bid" />
        <StatCard label="Ask depth" value={stats ? `$${formatCompact(stats.askDepth2pctUsd)}` : '-'} sub="±2% of mid" accent="ask" />
      </div>

      {/* Depth chart + order book */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="h-[300px] lg:col-span-7 lg:h-[560px]">
          {initialLoading || !book ? (
            <div className="glass-card flex h-full items-center justify-center">
              {initialLoading ? (
                <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-[var(--role-chrome)]" />
              ) : (
                <span className="text-sm text-[var(--role-content-subtle)]">No depth data.</span>
              )}
            </div>
          ) : (
            <DepthChartPanel book={book} mid={stats?.mid ?? null} />
          )}
        </div>
        <div className="h-[560px] lg:col-span-5">
          {initialLoading ? (
            <div className="glass-card h-full animate-pulse" />
          ) : book ? (
            <OrderBookPanel book={book} levels={20} />
          ) : (
            <div className="glass-card flex h-full items-center justify-center text-sm text-[var(--role-content-subtle)]">
              No order book data.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
