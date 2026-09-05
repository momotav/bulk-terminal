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

// Matches the backend order-book cache TTL. The backend coalesces upstream
// requests, so polling here stays cheap regardless of how many users are on the
// page — no need to poll faster than the cache refreshes.
const REFRESH_INTERVAL_MS = 5000;

function formatPrice(px: number): string {
  let decimals = 2;
  if (px < 10) decimals = 4;
  else if (px < 1000) decimals = 3;
  return px.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatSize(sz: number): string {
  return sz.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

// Round, evenly-spaced ticks from 0 to >= hi, aiming for ~`count` intervals of a
// "nice" size (1/2/5 × 10ⁿ). The last tick is the domain max, so an axis can pin
// its numeric domain to it and recharts won't regenerate its own labels.
function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = (raw / mag >= 5 ? 5 : raw / mag >= 2 ? 2 : 1) * mag;
  const niceMax = Math.ceil(hi / step) * step;
  const t: number[] = [];
  for (let v = 0; v <= niceMax + step * 1e-6; v += step) t.push(Number(v.toFixed(10)));
  return t;
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

// The default (BULK) depth chart focuses on the near-mid book; the deep tail of
// the full book (sparse stray orders far out) would otherwise compress all the
// real structure into a thin cliff. Everything past this stays available to the
// impact / simulator / compare tools that walk the whole book.
const DEFAULT_DEPTH_WINDOW = 0.02; // ±2% of mid

function buildDepthSeries(ob: OrderbookSnapshot, mid: number | null): DepthPoint[] {
  const inWin = (px: number) => mid == null || Math.abs(px - mid) / mid <= DEFAULT_DEPTH_WINDOW;
  const points: DepthPoint[] = [];
  let bidCum = 0;
  for (const l of ob.bids) {
    if (!inWin(l.px)) continue;
    bidCum += l.px * l.sz;
    points.push({ px: l.px, bid: bidCum });
  }
  let askCum = 0;
  for (const l of ob.asks) {
    if (!inWin(l.px)) continue;
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

  const depthData = useMemo(() => buildDepthSeries(book, mid), [book, mid]);
  // Per-price-level size (not cumulative), one point per level, split by side.
  // Clamped to the same near-mid window as the depth view.
  const levelData = useMemo<LevelPoint[]>(() => {
    const inWin = (px: number) => mid == null || Math.abs(px - mid) / mid <= DEFAULT_DEPTH_WINDOW;
    return [
      ...book.bids.filter((l) => inWin(l.px)).map((l) => ({ px: l.px, bid: l.sz })),
      ...book.asks.filter((l) => inWin(l.px)).map((l) => ({ px: l.px, ask: l.sz })),
    ].sort((a, b) => a.px - b.px);
  }, [book, mid]);

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
        <div className="flex items-center gap-2.5">
          {book.stale && (
            <span
              className="flex items-center gap-1 text-[10px] font-medium text-[var(--role-content-muted)]"
              title="Live feed momentarily unavailable - showing the last received book."
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              Delayed
            </span>
          )}
          <span className="text-[11px] font-medium" style={{ color: imbColor }}>
            {imbLabel} {imb >= 0 ? '+' : ''}{(imb * 100).toFixed(1)}%
          </span>
        </div>
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

  // Nice, sparse x ticks pinned to a numeric domain — recharts would otherwise
  // label every level and smear them together along the axis.
  const { xTicks, xDomain } = useMemo(() => {
    const hi = data.reduce((m, d) => Math.max(m, d.notional), 0);
    if (hi <= 0) return { xTicks: undefined, xDomain: [0, 'dataMax'] as [number, string] };
    const t = niceTicks(0, hi, 5);
    return { xTicks: t, xDomain: [0, t[t.length - 1]] as [number, number] };
  }, [data]);

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
            <AreaChart data={data} margin={{ top: 12, right: 30, bottom: 4, left: 4 }}>
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
              <XAxis dataKey="notional" type="number" domain={xDomain} allowDataOverflow ticks={xTicks} interval={0} minTickGap={24} tickFormatter={(v) => formatUsd(v)} tick={axisTick} axisLine={{ stroke: 'var(--role-line)' }} tickLine={false} />
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
    <div className="flex items-baseline justify-between border-b border-[var(--role-line-subtle)] py-1.5 last:border-0">
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
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
            Order exceeds the visible book - only {formatUsd(result.filledNotional)} fills before {side === 'buy' ? 'asks' : 'bids'} run out.
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
  { id: 'lighter', label: 'Lighter', available: true },
  { id: 'binance', label: 'Binance', available: true },
  { id: 'bybit', label: 'Bybit', available: true },
];
// BULK keeps the palette accent (the "home" venue, adapts to theme); the rest
// get fixed, maximally-distinct colours so five lines never blur together in a
// warm/monochrome palette — and they roughly echo each venue's brand.
const VENUE_COLOR: Record<string, string> = {
  bulk: 'var(--role-content)', // theme-aware high-contrast — the reference line, never clashes
  hyperliquid: '#6fae8e',      // muted sage green
  binance: '#c99a52',          // muted ochre (harmonizes with the warm palette)
  bybit: '#7f97c4',            // dusty blue
  lighter: '#a98cc0',          // muted mauve
};

type ActiveVenue = {
  id: string; label: string; color: string;
  bids: OrderbookLevel[]; asks: OrderbookLevel[]; mid: number; takerBps: number; spreadBps: number | null;
};

// ± distance presets (fraction of mid) for the multi-venue depth chart. Now
// that the full book is fetched, there's real (if sparse) depth well past ±2%,
// so the wider zooms are meaningful again.
const DEPTH_DISTANCES = [0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1];
function distLabel(d: number): string {
  const pct = d * 100;
  return `±${pct >= 1 ? pct : pct.toFixed(2)}%`;
}

// Build ONE dataset where every venue has a cumulative-$ value at every x (%
// from mid) within the window — so hovering shows a dot + value for every venue
// at once (like loris), not just the venue that happens to own that breakpoint.
// Each venue's depth is a step function of pct; we sample all of them on the
// union of their price breakpoints (downsampled for perf on dense CEX books).
function buildMergedDepth(venues: ActiveVenue[], distFrac: number): Record<string, number>[] {
  const lim = distFrac * 100;
  const prep = venues.map((v) => {
    const bid: { pct: number; cum: number }[] = [];
    let cum = 0;
    for (const l of v.bids) { cum += l.px * l.sz; bid.push({ pct: ((l.px - v.mid) / v.mid) * 100, cum }); }
    const ask: { pct: number; cum: number }[] = [];
    cum = 0;
    for (const l of v.asks) { cum += l.px * l.sz; ask.push({ pct: ((l.px - v.mid) / v.mid) * 100, cum }); }
    return { id: v.id, bid, ask };
  });

  const xs = new Set<number>([0]);
  for (const p of prep) {
    for (const b of p.bid) if (Math.abs(b.pct) <= lim) xs.add(b.pct);
    for (const a of p.ask) if (Math.abs(a.pct) <= lim) xs.add(a.pct);
  }
  let grid = [...xs].sort((a, b) => a - b);
  const MAX = 480;
  if (grid.length > MAX) {
    const step = grid.length / MAX;
    const s: number[] = [];
    for (let i = 0; i < grid.length; i += step) s.push(grid[Math.floor(i)]);
    if (s[s.length - 1] !== grid[grid.length - 1]) s.push(grid[grid.length - 1]);
    grid = s;
  }

  // Cumulative at pct q on one side (bids best-first pct-desc; asks best-first pct-asc).
  const valAt = (p: typeof prep[number], q: number): number => {
    if (q === 0) return 0;
    let c = 0;
    if (q < 0) { for (const b of p.bid) { if (b.pct >= q) c = b.cum; else break; } }
    else { for (const a of p.ask) { if (a.pct <= q) c = a.cum; else break; } }
    return c;
  };

  return grid.map((q) => {
    const row: Record<string, number> = { pct: q };
    for (const p of prep) row[p.id] = valAt(p, q);
    return row;
  });
}

// One "Compare" button that opens a checklist of venues to overlay. BULK is
// always on; the rest toggle. Closes on outside-click / Escape.
function CompareMenu({ enabled, onToggle }: { enabled: Record<string, boolean>; onToggle: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeCount = OVERLAY_VENUES.filter((v) => v.available && enabled[v.id]).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
      >
        <span>Compare{activeCount > 0 ? ` · ${activeCount}` : ''}</span>
        <svg className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-[var(--role-line)] bg-[var(--role-surface)] p-1.5 shadow-[var(--shadow-lg)]">
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">Overlay venues</div>
          <div className="flex items-center justify-between rounded-lg px-2 py-1.5">
            <span className="flex items-center gap-2 text-sm text-[var(--role-content)]">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: VENUE_COLOR.bulk }} /> BULK
            </span>
            <span className="text-[11px] text-[var(--role-content-subtle)]">always</span>
          </div>
          {OVERLAY_VENUES.map((v) => (
            <button
              key={v.id}
              disabled={!v.available}
              onClick={() => v.available && onToggle(v.id)}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors',
                v.available ? 'hover:bg-[var(--bg-secondary-20)]' : 'cursor-not-allowed opacity-50',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: enabled[v.id] && v.available ? VENUE_COLOR[v.id] : 'var(--role-content-subtle)' }} />
                <span className={enabled[v.id] ? 'text-[var(--role-content)]' : 'text-[var(--role-content-muted)]'}>{v.label}</span>
                {!v.available && <span className="text-[10px] text-[var(--role-content-subtle)]">soon</span>}
              </span>
              {v.available && (
                <span className={cn('flex h-4 w-4 items-center justify-center rounded border', enabled[v.id] ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--role-line)]')}>
                  {enabled[v.id] && (
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="var(--accent-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  const [dist, setDist] = useState(0.005); // ±0.5% default

  const data = useMemo(() => buildMergedDepth(venues, dist), [venues, dist]);
  // Per-venue totals + quote stats for the legend chips and the tooltip sublines.
  const meta = useMemo(() =>
    venues.map((v) => ({
      id: v.id, label: v.label, color: v.color, mid: v.mid, spreadBps: v.spreadBps,
      bidTotal: v.bids.reduce((s, l) => s + l.px * l.sz, 0),
      askTotal: v.asks.reduce((s, l) => s + l.px * l.sz, 0),
    })), [venues]);
  const metaById = useMemo(() => new Map(meta.map((m) => [m.id, m])), [meta]);

  const axisTick = { fill: 'var(--role-content-subtle)', fontSize: 10 };
  const dpct = dist * 100;
  // Draw BULK last so its (often shallower) line sits on top and stays visible.
  const drawOrder = [...venues.filter((v) => v.id !== 'bulk'), ...venues.filter((v) => v.id === 'bulk')];

  return (
    <div className="glass-card flex h-full flex-col">
      {/* Title + ±distance filter, one row. */}
      <div className="panel-header">
        <h2 className="panel-title t-h2">Market depth</h2>
        <div className="flex items-center gap-0.5">
          {DEPTH_DISTANCES.map((d) => (
            <button
              key={d}
              onClick={() => setDist(d)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap transition-colors',
                dist === d ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
              )}
            >
              {distLabel(d)}
            </button>
          ))}
        </div>
      </div>

      {/* Venue chips with bid/ask totals. */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-0.5">
        {meta.map((m) => (
          <span key={m.id} className="flex items-center gap-1.5 rounded-lg border border-[var(--role-line-subtle)] px-2 py-1 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: m.color }} />
            <span className="font-medium text-[var(--role-content)]">{m.label}</span>
            <span className="tabular-nums text-[var(--role-content-subtle)]">bid ${formatCompact(m.bidTotal)} / ask ${formatCompact(m.askTotal)}</span>
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <defs>
              {venues.map((v) => (
                <linearGradient key={v.id} id={`dep-${v.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={v.color} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={v.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <XAxis dataKey="pct" type="number" domain={[-dpct, dpct]} allowDataOverflow
              tickFormatter={(v) => `${v}%`} tick={axisTick} axisLine={{ stroke: 'var(--role-line)' }} tickLine={false} />
            <YAxis tickFormatter={(v) => `$${formatCompact(v)}`} tick={axisTick} axisLine={false} tickLine={false} width={52} />
            <ReferenceLine x={0} stroke="var(--role-content-subtle)" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: 'mid', position: 'top', fill: 'var(--role-content-subtle)', fontSize: 10 }} />
            <Tooltip
              cursor={{ stroke: 'var(--role-content-subtle)', strokeDasharray: '3 3', strokeOpacity: 0.4 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const q = Number(label);
                const side = q < 0 ? 'Bid' : q > 0 ? 'Ask' : 'Mid';
                const rows = payload
                  .map((p: any) => ({ id: p.dataKey as string, value: Number(p.value), color: p.stroke as string, m: metaById.get(p.dataKey) }))
                  .filter((r) => r.m)
                  .sort((a, b) => b.value - a.value);
                return (
                  <div className="min-w-[230px] rounded-[var(--radius-sm)] border border-[var(--role-line)] bg-[var(--role-surface)] px-3 py-2.5 shadow-[var(--shadow-lg)]">
                    <p className="mb-2 text-[11px] font-medium text-[var(--role-content)]">{side} {Math.abs(q).toFixed(2)}% from mid</p>
                    {rows.map((r) => (
                      <div key={r.id} className="mb-1.5 last:mb-0">
                        <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} />
                          <span className="text-[var(--role-content)]">{r.m!.label}</span>
                          <span className="ml-auto font-medium text-[var(--role-content)]">${formatCompact(r.value)}</span>
                        </div>
                        <p className="pl-3.5 text-[10px] text-[var(--role-content-subtle)]">Mid ${formatPrice(r.m!.mid)} · Spread {r.m!.spreadBps != null ? r.m!.spreadBps.toFixed(2) : '-'} bps</p>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {drawOrder.map((v) => (
              <Area key={v.id} type="stepAfter" dataKey={v.id} stroke={v.color} fill={`url(#dep-${v.id})`} strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} isAnimationActive={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Multi-venue price impact — slippage vs order size, one line per venue, for a
// chosen side. Renders in place of the BULK impact curve when comparing.
// ----------------------------------------------------------------------------

// Floor for log-scale rendering: a log axis can't take 0, and sub-0.01 bps
// slippage is visually meaningless anyway.
const LOG_FLOOR_BPS = 0.01;
const IMPACT_RANGES: { label: string; max: number | null }[] = [
  { label: '$10M', max: 10_000_000 },
  { label: '$100M', max: 100_000_000 },
  { label: 'Full', max: null },
];

function MultiVenueImpactPanel({ venues }: { venues: ActiveVenue[] }) {
  const [side, setSide] = useState<Side>('buy');
  const [metric, setMetric] = useState<'slip' | 'allin'>('slip');
  const [logScale, setLogScale] = useState(true);
  const [xmax, setXmax] = useState<number | null>(10_000_000);

  const data = useMemo(() => {
    const key = metric === 'allin' ? 'allInBps' : 'slipBps';
    const all: Record<string, number>[] = [];
    for (const v of venues) {
      const levels = side === 'buy' ? v.asks : v.bids;
      for (const p of buildImpactCurve(levels, v.mid, side, v.takerBps)) {
        if (xmax != null && p.notional > xmax) break; // points are ascending per venue
        if (logScale && p.notional <= 0) continue;    // log axis can't render 0
        all.push({ notional: p.notional, [v.id]: logScale ? Math.max(p[key], LOG_FLOOR_BPS) : p[key] });
      }
    }
    return all.sort((a, b) => (a.notional as number) - (b.notional as number));
  }, [venues, side, metric, logScale, xmax]);

  // Explicit ticks + a numeric domain that matches them. Without a fixed numeric
  // domain, recharts regenerates its own ticks (labelling every data point across
  // five deep books) and they collapse into a grey smear along the axis.
  const { xTicks, xDomain } = useMemo(() => {
    const ns = data.map((d) => d.notional as number).filter((n) => n > 0);
    if (ns.length === 0) return { xTicks: undefined, xDomain: (logScale ? ['auto', 'auto'] : [0, 'dataMax']) as [number | string, number | string] };
    const lo = Math.min(...ns), hi = Math.max(...ns);
    if (logScale) {
      const t: number[] = [];
      for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
        const v = Math.pow(10, e);
        if (v >= lo * 0.6 && v <= hi * 1.6) t.push(v);
      }
      return { xTicks: t.length ? t : undefined, xDomain: ['auto', 'auto'] as [string, string] };
    }
    const t = niceTicks(0, hi, 5);
    return { xTicks: t, xDomain: [0, t[t.length - 1]] as [number, number] };
  }, [data, logScale]);

  // Same treatment for the y (bps) axis, so tick labels are uniformly formatted
  // instead of a mix of "40", "15", "5.0", "0.00".
  const { yTicks, yDomain, yFmt } = useMemo(() => {
    let hi = 0, lo = Infinity;
    for (const d of data) for (const v of venues) {
      const y = d[v.id] as number | undefined;
      if (typeof y === 'number' && isFinite(y)) { if (y > hi) hi = y; if (y > 0 && y < lo) lo = y; }
    }
    if (hi <= 0) return { yTicks: undefined, yDomain: (logScale ? ['auto', 'auto'] : [0, 'auto']) as [number | string, number | string], yFmt: (v: number) => v.toFixed(0) };
    if (logScale) {
      const t: number[] = [];
      for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
        const v = Math.pow(10, e);
        if (v >= lo * 0.5 && v <= hi * 2) t.push(v);
      }
      const fmt = (v: number) => (v >= 1 ? v.toFixed(0) : v >= 0.1 ? v.toFixed(1) : v.toFixed(2));
      return { yTicks: t.length ? t : undefined, yDomain: ['auto', 'auto'] as [string, string], yFmt: fmt };
    }
    const t = niceTicks(0, hi, 4);
    const step = t.length > 1 ? t[1] - t[0] : t[0];
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return { yTicks: t, yDomain: [0, t[t.length - 1]] as [number, number], yFmt: (v: number) => v.toFixed(dec) };
  }, [data, venues, logScale]);

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

      {/* Toolbar: venue legend (left) + scale / x-range controls (right), one row. */}
      <div className="flex items-center justify-between gap-3 px-4 pt-1">
        <div className="flex flex-wrap items-center gap-3">
          {venues.map((v) => (
            <span key={v.id} className="flex items-center gap-1.5 text-[11px] text-[var(--role-content-muted)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: v.color }} /> {v.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            {IMPACT_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setXmax(r.max)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap transition-colors',
                  xmax === r.max ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            {([['Log', true], ['Linear', false]] as const).map(([label, isLog]) => (
              <button
                key={label}
                onClick={() => setLogScale(isLog)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors',
                  logScale === isLog ? 'bg-[var(--accent)] text-[var(--accent-text)]' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 30, bottom: 4, left: 4 }}>
            <XAxis dataKey="notional" type="number"
              scale={logScale ? 'log' : 'linear'}
              domain={xDomain} allowDataOverflow
              ticks={xTicks} interval={0} minTickGap={24}
              tickFormatter={(v) => formatUsd(v)} tick={axisTick} axisLine={{ stroke: 'var(--role-line)' }} tickLine={false} />
            <YAxis
              scale={logScale ? 'log' : 'linear'}
              domain={yDomain} allowDataOverflow
              ticks={yTicks} interval={0}
              tickFormatter={yFmt}
              tick={axisTick} axisLine={false} tickLine={false} width={44} unit=" bps" />
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
      // Ask for the full book (BULK returns however many real levels exist —
      // ~130 on testnet, spanning well past ±2% of mid). The ladder still shows
      // the top 20; the depth/impact/compare tools walk the whole thing.
      const snap = await analytics.getOrderbook(target, 500);
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
      bids: book.bids, asks: book.asks, mid: book.stats.mid ?? 0, takerBps: BULK_TAKER_BPS, spreadBps: book.stats.spreadBps,
    }];
    for (const v of compare?.venues ?? []) {
      if (v.ok && v.bids && v.asks && v.stats?.mid) {
        list.push({
          id: v.id, label: v.label, color: VENUE_COLOR[v.id] ?? 'var(--coin-7)',
          bids: v.bids, asks: v.asks, mid: v.stats.mid, takerBps: v.takerBps ?? 0, spreadBps: v.stats.spreadBps,
        });
      }
    }
    return list;
  }, [book, compare]);
  const multi = comparing && activeVenues.length > 1;

  return (
    <div className="w-full space-y-4 p-4 md:p-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl font-medium leading-none tracking-tight text-[var(--role-content)] sm:text-[28px]">
          Order book
        </h1>
        <div className="flex items-center gap-2">
          <CompareMenu enabled={enabled} onToggle={toggleVenue} />
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
        <div className="h-[300px] lg:col-span-7 lg:h-[392px]">
          {initialLoading || !book ? (
            <div className="glass-card h-full animate-pulse" />
          ) : multi ? (
            <MultiVenueImpactPanel venues={activeVenues} />
          ) : (
            <ImpactCurvePanel book={book} mid={stats?.mid ?? null} />
          )}
        </div>
        <div className="h-auto lg:col-span-5 lg:h-[392px]">
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
