'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Customized,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analytics, formatCompact, cn, type OrderbookSnapshot, type OrderbookLevel, type OrderbookStats, type OrderbookCompare } from '@/lib/api';
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

function formatUsd(n: number): string {
  return `$${formatCompact(n)}`;
}

// BULK taker fee, in bps, used for the "all-in" execution cost (slippage + fee).
// A market order is a taker fill. Per BULK's published fee schedule the taker
// fee is tiered by 14-day volume: 3.5 bps (tier 1) down to 2.2 bps (tier 8).
// We use the tier-1 rate — what most accounts pay — as the default; slippage
// itself is exact regardless of tier.
const BULK_TAKER_BPS = 3.5;

// ----------------------------------------------------------------------------
// Execution math — walk one side of the book to price a market order.
// asks are ascending (a BUY lifts them); bids are descending (a SELL hits them).
// slippage is measured as the average fill vs the mid, in bps; all-in folds in
// the taker fee. Both auto-scale to whatever depth the book actually has, so a
// shallow testnet book and a deep mainnet book both render sensibly.
// ----------------------------------------------------------------------------

type Side = 'buy' | 'sell';

type ImpactPoint = { notional: number; avgFill: number; slipBps: number; allInBps: number };

function buildImpactCurve(levels: OrderbookLevel[], mid: number, side: Side, takerBps: number): ImpactPoint[] {
  if (!mid || levels.length === 0) return [];
  const out: ImpactPoint[] = [{ notional: 0, avgFill: mid, slipBps: 0, allInBps: takerBps }];
  let cumSize = 0;
  let cumCost = 0;
  for (const l of levels) {
    cumSize += l.sz;
    cumCost += l.px * l.sz;
    const avgFill = cumCost / cumSize;
    const slip = side === 'buy' ? ((avgFill - mid) / mid) * 1e4 : ((mid - avgFill) / mid) * 1e4;
    const slipBps = Math.max(0, slip);
    out.push({ notional: cumCost, avgFill, slipBps, allInBps: slipBps + takerBps });
  }
  return out;
}

type SimResult = {
  filledSize: number;
  filledNotional: number;
  avgFill: number | null;
  slipBps: number | null;
  allInBps: number | null;
  bookExhausted: boolean;   // target larger than the whole book on that side
  bookNotional: number;     // total notional available on that side
};

function simulateOrder(levels: OrderbookLevel[], mid: number, side: Side, targetNotional: number, takerBps: number): SimResult {
  const bookNotional = levels.reduce((s, l) => s + l.px * l.sz, 0);
  let cumSize = 0;
  let cumCost = 0;
  for (const l of levels) {
    const levelNotional = l.px * l.sz;
    if (cumCost + levelNotional >= targetNotional) {
      const remaining = targetNotional - cumCost;
      cumSize += remaining / l.px;
      cumCost += remaining;
      const avgFill = cumCost / cumSize;
      const slip = Math.max(0, side === 'buy' ? ((avgFill - mid) / mid) * 1e4 : ((mid - avgFill) / mid) * 1e4);
      return { filledSize: cumSize, filledNotional: cumCost, avgFill, slipBps: slip, allInBps: slip + takerBps, bookExhausted: false, bookNotional };
    }
    cumSize += l.sz;
    cumCost += levelNotional;
  }
  // Ran out of book before filling the target.
  const avgFill = cumSize > 0 ? cumCost / cumSize : null;
  const slip = avgFill != null ? Math.max(0, side === 'buy' ? ((avgFill - mid) / mid) * 1e4 : ((mid - avgFill) / mid) * 1e4) : null;
  return {
    filledSize: cumSize,
    filledNotional: cumCost,
    avgFill,
    slipBps: slip,
    allInBps: slip != null ? slip + takerBps : null,
    bookExhausted: targetNotional > bookNotional,
    bookNotional,
  };
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
// Price-impact curve — how far a market order walks the book, per side.
// ----------------------------------------------------------------------------

function ImpactCurvePanel({ book, mid }: { book: OrderbookSnapshot; mid: number | null }) {
  const [metric, setMetric] = useState<'slip' | 'allin'>('slip');

  const data = useMemo(() => {
    if (mid == null) return [];
    const key = metric === 'allin' ? 'allInBps' : 'slipBps';
    const buy = buildImpactCurve(book.asks, mid, 'buy', BULK_TAKER_BPS);
    const sell = buildImpactCurve(book.bids, mid, 'sell', BULK_TAKER_BPS);
    return [
      ...buy.map((p) => ({ notional: p.notional, buy: p[key] })),
      ...sell.map((p) => ({ notional: p.notional, sell: p[key] })),
    ].sort((a, b) => a.notional - b.notional);
  }, [book, mid, metric]);

  const axisTick = { fill: 'var(--role-content-subtle)', fontSize: 10 };

  return (
    <div className="glass-card flex h-full flex-col">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2">Price impact</h2>
          <p className="t-caption truncate">slippage as a market order walks the book</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 md:flex">
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--role-content-muted)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--neg)' }} /> Buy
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--role-content-muted)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--pos)' }} /> Sell
            </span>
          </div>
          <div className="toggle-group">
            <button onClick={() => setMetric('slip')} className={cn('toggle-btn', metric === 'slip' && 'active')}>Slippage</button>
            <button onClick={() => setMetric('allin')} className={cn('toggle-btn', metric === 'allin' && 'active')}>All-in</button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-2 py-3">
        {data.length <= 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--role-content-subtle)]">Not enough depth.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="imp-buy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ASK} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={ASK} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="imp-sell" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BID} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={BID} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="notional" type="number" domain={[0, 'dataMax']} tickFormatter={(v) => formatUsd(v)} tick={axisTick} axisLine={{ stroke: 'var(--role-line)' }} tickLine={false} />
              <YAxis tickFormatter={(v) => `${v.toFixed(0)}`} tick={axisTick} axisLine={false} tickLine={false} width={40} unit=" bps" />
              <Tooltip
                cursor={{ stroke: 'var(--role-content-subtle)', strokeDasharray: '3 3', strokeOpacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const row = payload[0].payload as { notional: number; buy?: number; sell?: number };
                  return (
                    <div className="min-w-[180px] rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)] px-3 py-2 shadow-[var(--shadow-lg)]">
                      <p className="mb-1.5 font-mono text-[11px] text-[var(--role-content-subtle)]">Order size {formatUsd(row.notional)}</p>
                      {typeof row.buy === 'number' && (
                        <p className="flex items-center gap-2 font-mono text-xs tabular-nums">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--neg)' }} />
                          <span className="text-[var(--role-content-muted)]">Buy</span>
                          <span className="ml-auto font-medium text-[var(--role-content)]">{row.buy.toFixed(2)} bps</span>
                        </p>
                      )}
                      {typeof row.sell === 'number' && (
                        <p className="flex items-center gap-2 font-mono text-xs tabular-nums">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--pos)' }} />
                          <span className="text-[var(--role-content-muted)]">Sell</span>
                          <span className="ml-auto font-medium text-[var(--role-content)]">{row.sell.toFixed(2)} bps</span>
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="buy" stroke={ASK} fill="url(#imp-buy)" strokeWidth={1.75} connectNulls isAnimationActive={false} dot={false} />
              <Area type="monotone" dataKey="sell" stroke={BID} fill="url(#imp-sell)" strokeWidth={1.75} connectNulls isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Size simulator — enter a clip, get the fill, slippage and all-in cost.
// ----------------------------------------------------------------------------

const SIM_PRESETS = [100_000, 1_000_000, 10_000_000];

function SizeSimPanel({ book, mid }: { book: OrderbookSnapshot; mid: number | null }) {
  const [side, setSide] = useState<Side>('buy');
  const [notional, setNotional] = useState<number>(1_000_000);

  const levels = side === 'buy' ? book.asks : book.bids;
  const result = useMemo(
    () => (mid != null ? simulateOrder(levels, mid, side, notional, BULK_TAKER_BPS) : null),
    [levels, mid, side, notional]
  );
  const fullNotional = useMemo(() => levels.reduce((s, l) => s + l.px * l.sz, 0), [levels]);

  const Row = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
    <div className="flex items-baseline justify-between border-b border-[var(--role-line-subtle)] py-2 last:border-0">
      <span className="text-xs text-[var(--role-content-muted)]">{label}</span>
      <span className="font-mono text-sm font-medium tabular-nums" style={{ color: accent ?? 'var(--role-content)' }}>{value}</span>
    </div>
  );

  return (
    <div className="glass-card flex h-full flex-col">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2">Cost to trade</h2>
          <p className="t-caption truncate">simulate a market order</p>
        </div>
        <div className="toggle-group">
          <button onClick={() => setSide('buy')} className={cn('toggle-btn', side === 'buy' && 'active')}>Buy</button>
          <button onClick={() => setSide('sell')} className={cn('toggle-btn', side === 'sell' && 'active')}>Sell</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4">
        {/* Size input + presets */}
        <div>
          <label className="mb-1.5 block text-[11px] text-[var(--role-content-subtle)]">Order size (USD)</label>
          <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-background)]/40 px-3 py-2">
            <span className="text-[var(--role-content-subtle)]">$</span>
            <input
              type="number"
              min={0}
              value={notional}
              onChange={(e) => setNotional(Math.max(0, Number(e.target.value) || 0))}
              className="w-full bg-transparent font-mono text-sm tabular-nums text-[var(--role-content)] outline-none"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SIM_PRESETS.map((p) => (
              <button key={p} onClick={() => setNotional(p)} className={cn('toggle-btn', notional === p && 'active')}>{formatUsd(p)}</button>
            ))}
            <button onClick={() => setNotional(Math.round(fullNotional))} className="toggle-btn">Full</button>
          </div>
        </div>

        {/* Result */}
        {result && result.avgFill != null ? (
          <div className="rounded-[var(--radius-sm)] border border-[var(--role-line-subtle)] bg-[var(--role-background)]/30 px-3">
            <Row label="Avg fill price" value={`$${formatPrice(result.avgFill)}`} />
            <Row label="Slippage" value={`${formatBps(result.slipBps)} bps`} accent={result.slipBps && result.slipBps > 0 ? (side === 'buy' ? 'var(--neg)' : 'var(--pos)') : undefined} />
            <Row label={`All-in (incl. ${BULK_TAKER_BPS} bps taker)`} value={`${formatBps(result.allInBps)} bps`} />
            <Row label="Est. cost vs mid" value={result.slipBps != null ? formatUsd((result.allInBps! / 1e4) * result.filledNotional) : '-'} />
            <Row label="Filled" value={`${formatUsd(result.filledNotional)} of ${formatUsd(fullNotional)}`} />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--role-content-subtle)]">Enter a size.</div>
        )}

        {result?.bookExhausted && (
          <div className="rounded-[var(--radius-sm)] px-3 py-2 text-[11px]" style={{ backgroundColor: 'rgb(var(--neg-rgb) / 0.1)', color: 'var(--neg)' }}>
            Order exceeds the visible book — only {formatUsd(result.filledNotional)} fills before {side === 'buy' ? 'asks' : 'bids'} run out.
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Venue overlays — BULK is always drawn; these can be toggled on from the header
// switcher to overlay their book on the depth + impact charts (and add a row to
// the liquidity table). Colours come from the palette coin ramp so they follow
// the active theme; BULK is the accent.
// ----------------------------------------------------------------------------

const OVERLAY_VENUES: { id: string; label: string; available: boolean }[] = [
  { id: 'hyperliquid', label: 'Hyperliquid', available: true },
  { id: 'lighter', label: 'Lighter', available: false },
  { id: 'binance', label: 'Binance', available: false },
  { id: 'bybit', label: 'Bybit', available: false },
];
const VENUE_COLOR: Record<string, string> = {
  bulk: 'var(--accent)',
  hyperliquid: 'var(--coin-3)',
  lighter: 'var(--coin-5)',
  binance: 'var(--coin-1)',
  bybit: 'var(--coin-6)',
};

type ActiveVenue = {
  id: string; label: string; color: string;
  bids: OrderbookLevel[]; asks: OrderbookLevel[]; mid: number; takerBps: number;
};

// ± distance presets (fraction of mid) for the multi-venue depth chart.
const DEPTH_DISTANCES = [0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1];
function distLabel(d: number): string {
  const pct = d * 100;
  return `±${pct >= 1 ? pct : pct.toFixed(2)}%`;
}

// Cumulative resting $ vs % from mid for one venue (a V around mid), keyed by
// the venue id so several venues merge into one recharts dataset.
function venueDepthPoints(v: ActiveVenue): Record<string, number>[] {
  const pts: Record<string, number>[] = [{ pct: 0, [v.id]: 0 }];
  let cum = 0;
  for (const l of v.bids) { cum += l.px * l.sz; pts.push({ pct: ((l.px - v.mid) / v.mid) * 100, [v.id]: cum }); }
  cum = 0;
  for (const l of v.asks) { cum += l.px * l.sz; pts.push({ pct: ((l.px - v.mid) / v.mid) * 100, [v.id]: cum }); }
  return pts;
}

// ----------------------------------------------------------------------------
// Cross-exchange liquidity table — the flagship Compare view. Rows are venues
// (BULK pinned + highlighted on top), columns are clip sizes; each cell is the
// slippage in bps to fill that clip on that venue, colour-graded green→red.
// ----------------------------------------------------------------------------

const CMP_SIZES = [10_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000];

// Slippage (bps) to fill `notional` on one side, or null if it exceeds the book.
function slipForSize(levels: OrderbookLevel[], mid: number, side: Side, notional: number): number | null {
  const r = simulateOrder(levels, mid, side, notional, 0);
  return r.bookExhausted || r.slipBps == null ? null : r.slipBps;
}

// green (cheap) → red (expensive); transparent when the clip can't fill.
function bpsHeat(bps: number | null): string {
  if (bps == null) return 'transparent';
  const t = Math.min(1, bps / 15); // 15 bps ≈ full red
  const hue = 130 - t * 130;
  return `hsl(${hue} 58% 45% / 0.20)`;
}

type CmpRow = { key: string; label: string; highlight: boolean; bids: OrderbookLevel[]; asks: OrderbookLevel[]; stats: OrderbookStats };

function CompareLiquidityTable({ book, compare, base }: { book: OrderbookSnapshot; compare: OrderbookCompare | null; base: string }) {
  const [side, setSide] = useState<Side>('buy');

  const rows = useMemo<CmpRow[]>(() => {
    const out: CmpRow[] = [{ key: 'bulk', label: 'BULK', highlight: true, bids: book.bids, asks: book.asks, stats: book.stats }];
    for (const v of compare?.venues ?? []) {
      if (v.ok && v.bids && v.asks && v.stats) {
        out.push({ key: v.id, label: v.label, highlight: false, bids: v.bids, asks: v.asks, stats: v.stats });
      }
    }
    return out;
  }, [book, compare]);

  const th = 'px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)] whitespace-nowrap';
  const td = 'px-3 py-2.5 text-right font-mono text-xs tabular-nums whitespace-nowrap';

  return (
    <div className="glass-card flex flex-col">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2">Cross-exchange liquidity</h2>
          <p className="t-caption truncate">{base} {side === 'buy' ? 'BUY' : 'SELL'} ladder · slippage in bps to fill each clip</p>
        </div>
        <div className="toggle-group">
          <button onClick={() => setSide('buy')} className={cn('toggle-btn', side === 'buy' && 'active')}>Buy</button>
          <button onClick={() => setSide('sell')} className={cn('toggle-btn', side === 'sell' && 'active')}>Sell</button>
        </div>
      </div>

      <div className="min-h-0 overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--role-line)]">
              <th className={cn(th, 'text-left')}>Exchange</th>
              <th className={th}>Mid</th>
              <th className={th}>Spread</th>
              <th className={th}>Best Bid</th>
              <th className={th}>Best Ask</th>
              {CMP_SIZES.map((s) => (
                <th key={s} className={th}>{formatUsd(s)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const levels = side === 'buy' ? r.asks : r.bids;
              const mid = r.stats.mid ?? 0;
              return (
                <tr
                  key={r.key}
                  className="border-b border-[var(--role-line-subtle)] last:border-0"
                  style={r.highlight ? { background: 'rgb(var(--pos-rgb) / 0.06)' } : undefined}
                >
                  <td className={cn(td, 'text-left')}>
                    <span className="flex items-center gap-2">
                      {r.highlight && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--role-chrome)' }} />}
                      <span className={cn('font-sans font-medium', r.highlight ? 'text-[var(--role-content)]' : 'text-[var(--role-content-muted)]')}>{r.label}</span>
                    </span>
                  </td>
                  <td className={cn(td, 'text-[var(--role-content-muted)]')}>{mid ? `$${formatPrice(mid)}` : '-'}</td>
                  <td className={cn(td, 'text-[var(--role-content-muted)]')}>{formatBps(r.stats.spreadBps)}</td>
                  <td className={td} style={{ color: 'var(--pos)' }}>{r.stats.bestBid ? `$${formatPrice(r.stats.bestBid.px)}` : '-'}</td>
                  <td className={td} style={{ color: 'var(--neg)' }}>{r.stats.bestAsk ? `$${formatPrice(r.stats.bestAsk.px)}` : '-'}</td>
                  {CMP_SIZES.map((s) => {
                    const bps = mid ? slipForSize(levels, mid, side, s) : null;
                    return (
                      <td key={s} className={td} style={{ backgroundColor: bpsHeat(bps), color: bps == null ? 'var(--role-content-subtle)' : 'var(--role-content)' }}>
                        {bps == null ? '-' : `${bps.toFixed(2)}`}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[11px] text-[var(--role-content-subtle)]">
        Cells show pure book slippage (bps). "-" means the clip is larger than the visible book on that venue. Venue books are top-of-book depth from each exchange's public feed.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Multi-venue market depth — cumulative resting $ by % from mid, one line per
// venue, with a ± distance filter. Renders in place of the BULK depth chart
// whenever a venue overlay is toggled on.
// ----------------------------------------------------------------------------

function MultiVenueDepthPanel({ venues }: { venues: ActiveVenue[] }) {
  const [dist, setDist] = useState(0.01); // ±1% default

  const data = useMemo(() => {
    const lim = dist * 100 + 1e-9;
    const all: Record<string, number>[] = [];
    for (const v of venues) all.push(...venueDepthPoints(v).filter((p) => Math.abs(p.pct) <= lim));
    return all.sort((a, b) => (a.pct as number) - (b.pct as number));
  }, [venues, dist]);

  const axisTick = { fill: 'var(--role-content-subtle)', fontSize: 10 };
  const dpct = dist * 100;

  return (
    <div className="glass-card flex h-full flex-col">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2">Market depth</h2>
          <p className="t-caption truncate">cumulative resting liquidity by % from mid, across venues</p>
        </div>
        <div className="flex max-w-[60%] flex-wrap items-center justify-end gap-1">
          {DEPTH_DISTANCES.map((d) => (
            <button key={d} onClick={() => setDist(d)} className={cn('toggle-btn', dist === d && 'active')}>{distLabel(d)}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 pt-1">
        {venues.map((v) => (
          <span key={v.id} className="flex items-center gap-1.5 text-[11px] text-[var(--role-content-muted)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: v.color }} /> {v.label}
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <XAxis dataKey="pct" type="number" domain={[-dpct, dpct]} allowDataOverflow
              tickFormatter={(v) => `${v}%`} tick={axisTick} axisLine={{ stroke: 'var(--role-line)' }} tickLine={false} />
            <YAxis tickFormatter={(v) => `$${formatCompact(v)}`} tick={axisTick} axisLine={false} tickLine={false} width={52} />
            <ReferenceLine x={0} stroke="var(--role-content-subtle)" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: 'mid', position: 'top', fill: 'var(--role-content-subtle)', fontSize: 10 }} />
            <Tooltip
              cursor={{ stroke: 'var(--role-content-subtle)', strokeDasharray: '3 3', strokeOpacity: 0.4 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                return (
                  <div className="min-w-[180px] rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)] px-3 py-2 shadow-[var(--shadow-lg)]">
                    <p className="mb-1.5 font-mono text-[11px] text-[var(--role-content-subtle)]">{Number(label).toFixed(3)}% from mid</p>
                    {payload.map((p: any) => (
                      <p key={p.dataKey} className="flex items-center gap-2 font-mono text-xs tabular-nums">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.stroke }} />
                        <span className="text-[var(--role-content-muted)]">{venues.find((v) => v.id === p.dataKey)?.label ?? p.dataKey}</span>
                        <span className="ml-auto font-medium text-[var(--role-content)]">${formatCompact(p.value)}</span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            {venues.map((v) => (
              <Line key={v.id} type="monotone" dataKey={v.id} stroke={v.color} strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Multi-venue price impact — slippage vs order size, one line per venue, for a
// chosen side. Renders in place of the BULK impact curve when comparing.
// ----------------------------------------------------------------------------

function MultiVenueImpactPanel({ venues }: { venues: ActiveVenue[] }) {
  const [side, setSide] = useState<Side>('buy');
  const [metric, setMetric] = useState<'slip' | 'allin'>('slip');

  const data = useMemo(() => {
    const key = metric === 'allin' ? 'allInBps' : 'slipBps';
    const all: Record<string, number>[] = [];
    for (const v of venues) {
      const levels = side === 'buy' ? v.asks : v.bids;
      for (const p of buildImpactCurve(levels, v.mid, side, v.takerBps)) {
        all.push({ notional: p.notional, [v.id]: p[key] });
      }
    }
    return all.sort((a, b) => (a.notional as number) - (b.notional as number));
  }, [venues, side, metric]);

  const axisTick = { fill: 'var(--role-content-subtle)', fontSize: 10 };

  return (
    <div className="glass-card flex h-full flex-col">
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2">Price impact</h2>
          <p className="t-caption truncate">{side === 'buy' ? 'buy' : 'sell'} slippage vs order size, across venues</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="toggle-group">
            <button onClick={() => setSide('buy')} className={cn('toggle-btn', side === 'buy' && 'active')}>Buy</button>
            <button onClick={() => setSide('sell')} className={cn('toggle-btn', side === 'sell' && 'active')}>Sell</button>
          </div>
          <div className="toggle-group">
            <button onClick={() => setMetric('slip')} className={cn('toggle-btn', metric === 'slip' && 'active')}>Slippage</button>
            <button onClick={() => setMetric('allin')} className={cn('toggle-btn', metric === 'allin' && 'active')}>All-in</button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 pt-1">
        {venues.map((v) => (
          <span key={v.id} className="flex items-center gap-1.5 text-[11px] text-[var(--role-content-muted)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: v.color }} /> {v.label}
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <XAxis dataKey="notional" type="number" domain={[0, 'dataMax']} tickFormatter={(v) => formatUsd(v)} tick={axisTick} axisLine={{ stroke: 'var(--role-line)' }} tickLine={false} />
            <YAxis tickFormatter={(v) => `${v.toFixed(0)}`} tick={axisTick} axisLine={false} tickLine={false} width={40} unit=" bps" />
            <Tooltip
              cursor={{ stroke: 'var(--role-content-subtle)', strokeDasharray: '3 3', strokeOpacity: 0.4 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                return (
                  <div className="min-w-[180px] rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)] px-3 py-2 shadow-[var(--shadow-lg)]">
                    <p className="mb-1.5 font-mono text-[11px] text-[var(--role-content-subtle)]">Order size {formatUsd(Number(label))}</p>
                    {payload.map((p: any) => (
                      <p key={p.dataKey} className="flex items-center gap-2 font-mono text-xs tabular-nums">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.stroke }} />
                        <span className="text-[var(--role-content-muted)]">{venues.find((v) => v.id === p.dataKey)?.label ?? p.dataKey}</span>
                        <span className="ml-auto font-medium text-[var(--role-content)]">{Number(p.value).toFixed(2)} bps</span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            {venues.map((v) => (
              <Line key={v.id} type="monotone" dataKey={v.id} stroke={v.color} strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function OrderBookPage() {
  const [coin, setCoin] = useState<Market>('BTC-USD');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const { network } = useCurrentNetwork();
  const [book, setBook] = useState<OrderbookSnapshot | null>(null);
  const [compare, setCompare] = useState<OrderbookCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const lastFetchedCoinRef = useRef<Market | null>(null);

  const fetchBook = useCallback(async (target: Market, resetLoading: boolean) => {
    if (resetLoading) setInitialLoading(true);
    try {
      // 50 levels: the ladder still shows the top 20, but the impact curve and
      // size simulator get a deeper book to walk for larger clips.
      const snap = await analytics.getOrderbook(target, 50);
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

  const enabledIds = OVERLAY_VENUES.filter((v) => v.available && enabled[v.id]).map((v) => v.id);
  const comparing = enabledIds.length > 0;
  const enabledKey = enabledIds.join(',');
  const toggleVenue = (id: string) => setEnabled((e) => ({ ...e, [id]: !e[id] }));

  // Cross-exchange feed — only polled while a venue overlay is toggled on.
  useEffect(() => {
    if (!enabledKey) { setCompare(null); return; }
    let alive = true;
    const load = async () => {
      try { const c = await analytics.getOrderbookCompare(coin, enabledKey.split(',')); if (alive) setCompare(c); } catch { /* keep last */ }
    };
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [enabledKey, coin, network]);

  const stats = book?.stats;

  // BULK is always drawn first; enabled + live venues overlay on top.
  const activeVenues = useMemo<ActiveVenue[]>(() => {
    if (!book) return [];
    const list: ActiveVenue[] = [{
      id: 'bulk', label: 'BULK', color: VENUE_COLOR.bulk,
      bids: book.bids, asks: book.asks, mid: book.stats.mid ?? 0, takerBps: BULK_TAKER_BPS,
    }];
    for (const v of compare?.venues ?? []) {
      if (v.ok && v.bids && v.asks && v.stats?.mid) {
        list.push({
          id: v.id, label: v.label, color: VENUE_COLOR[v.id] ?? 'var(--coin-7)',
          bids: v.bids, asks: v.asks, mid: v.stats.mid, takerBps: v.takerBps ?? 0,
        });
      }
    }
    return list;
  }, [book, compare]);
  const multi = comparing && activeVenues.length > 1;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-medium leading-none tracking-tight text-[var(--role-content)] sm:text-[28px]">
          Order book
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Overlay switcher: BULK is always drawn; toggle venues onto the charts. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1.5 rounded-full border border-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--role-content)]" style={{ backgroundColor: 'rgb(var(--accent-rgb, 0 0 0) / 0.08)' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: VENUE_COLOR.bulk }} /> BULK
            </span>
            {OVERLAY_VENUES.map((v) => v.available ? (
              <button
                key={v.id}
                onClick={() => toggleVenue(v.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  enabled[v.id] ? 'border-[var(--accent)] text-[var(--role-content)]' : 'border-[var(--role-line)] text-[var(--role-content-muted)] hover:text-[var(--role-content)]'
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: enabled[v.id] ? VENUE_COLOR[v.id] : 'var(--role-content-subtle)' }} /> {v.label}
              </button>
            ) : (
              <span key={v.id} className="flex items-center gap-1.5 rounded-full border border-[var(--role-line-subtle)] px-2.5 py-1 text-[11px] text-[var(--role-content-subtle)]">
                {v.label} <span className="opacity-60">soon</span>
              </span>
            ))}
          </div>
          <MarketSelector value={coin} onChange={setCoin} />
        </div>
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
          ) : multi ? (
            <MultiVenueDepthPanel venues={activeVenues} />
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

      {/* Execution tools: price-impact curve + size simulator */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="h-[340px] lg:col-span-7">
          {initialLoading || !book ? (
            <div className="glass-card h-full animate-pulse" />
          ) : multi ? (
            <MultiVenueImpactPanel venues={activeVenues} />
          ) : (
            <ImpactCurvePanel book={book} mid={stats?.mid ?? null} />
          )}
        </div>
        <div className="h-[340px] lg:col-span-5">
          {initialLoading || !book ? (
            <div className="glass-card h-full animate-pulse" />
          ) : (
            <SizeSimPanel book={book} mid={stats?.mid ?? null} />
          )}
        </div>
      </div>

      {/* Cross-exchange liquidity table — shown below the charts while comparing. */}
      {multi && book && <CompareLiquidityTable book={book} compare={compare} base={coin.replace('-USD', '')} />}
    </div>
  );
}
