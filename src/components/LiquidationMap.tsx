'use client';

// LiquidationMap — a HyperDash-style liquidation view built from BULK's REAL
// recorded liquidation events (not a projected map — BULK exposes no aggregate
// open-position data, so forward-looking liquidation levels aren't possible).
//
// Two modes:
//   • Profile   — liquidation notional by price level (long red / short green)
//                 with cumulative curves emanating from the live price.
//   • Heatmap   — a time × price grid coloured by liquidation notional.
// Plus Fine/Medium/Coarse price granularity and a Coin/USD denomination toggle.
// All bucketing is client-side from one events payload.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, Bar, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { createChart, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { analytics, cn, formatCompact, type Candle } from '@/lib/api';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { useIsMobile } from '@/hooks/useIsMobile';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';
const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'PUMP', 'ZEC'];
const GRAN = { fine: 140, medium: 80, coarse: 40 } as const;
type Gran = keyof typeof GRAN;

interface LiqEvent { side: string; price: number; size: number; value: number; timestamp: number | string; }
const LONG = 'var(--neg)';   // long liquidations = red (forced sells)
const SHORT = 'var(--pos)';  // short liquidations = green (forced buys)

export function LiquidationMap({ lockedCoin, embedded }: { lockedCoin?: string; embedded?: boolean } = {}) {
  const { network } = useCurrentNetwork();
  const isMobile = useIsMobile();
  const [coin, setCoin] = useState(lockedCoin ?? 'BTC');
  useEffect(() => { if (lockedCoin) setCoin(lockedCoin); }, [lockedCoin]);
  const [mode, setMode] = useState<'profile' | 'heatmap'>('profile');
  const [gran, setGran] = useState<Gran>('medium');
  const [denom, setDenom] = useState<'coin' | 'usd'>('usd');
  const [events, setEvents] = useState<LiqEvent[]>([]);
  const [price, setPrice] = useState(0);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_URL}${withNetwork(`/api/analytics/liquidations/map/${coin}?hours=${8760}`)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setEvents(Array.isArray(d.events) ? d.events : []);
        setPrice(Number(d.currentPrice) || 0);
      })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [coin, network]);

  // Candles for the heatmap overlay — same coin, aligned by time & price.
  useEffect(() => {
    let cancelled = false;
    analytics.getCandles(coin, '1h', 180)
      .then((r) => { if (!cancelled) setCandles(Array.isArray(r?.candles) ? r.candles : []); })
      .catch(() => { if (!cancelled) setCandles([]); });
    return () => { cancelled = true; };
  }, [coin, network]);

  const val = (e: LiqEvent) => (denom === 'usd' ? e.value : e.size);
  const nBuckets = GRAN[gran];

  // ---- Profile: notional by price bucket + cumulative from the live price ----
  const profile = useMemo(() => {
    if (events.length === 0) return [] as any[];
    const prices = events.map((e) => e.price);
    const min = Math.min(...prices), max = Math.max(...prices);
    if (!(max > min)) return [];
    const step = (max - min) / nBuckets;
    const buckets = Array.from({ length: nBuckets }, (_, i) => ({ price: min + step * (i + 0.5), long: 0, short: 0, cumLong: 0, cumShort: 0 }));
    for (const e of events) {
      let i = Math.floor((e.price - min) / step);
      if (i < 0) i = 0; if (i >= nBuckets) i = nBuckets - 1;
      if (/long/i.test(e.side)) buckets[i].long += val(e); else buckets[i].short += val(e);
    }
    // Cumulative curves emanate from the bucket nearest the live price: longs
    // accumulate downward (lower prices), shorts upward (higher prices).
    const ci = price > 0 ? Math.max(0, Math.min(nBuckets - 1, Math.floor((price - min) / step))) : Math.floor(nBuckets / 2);
    let acc = 0;
    for (let i = ci; i >= 0; i--) { acc += buckets[i].long; buckets[i].cumLong = acc; }
    acc = 0;
    for (let i = ci; i < nBuckets; i++) { acc += buckets[i].short; buckets[i].cumShort = acc; }
    return buckets;
  }, [events, nBuckets, denom, price]);

  // ---- Heatmap over candles: columns = candles (shared time axis), rows =
  // price buckets across the candle price range (shared price axis). ----
  const heat = useMemo(() => {
    if (candles.length < 2) return null;
    const lows = candles.map((c) => c.l), highs = candles.map((c) => c.h);
    let pMin = Math.min(...lows), pMax = Math.max(...highs);
    if (!(pMax > pMin)) return null;
    const pad = (pMax - pMin) * 0.04; pMin -= pad; pMax += pad; // breathing room
    // More rows → smaller, squarer cells (drawn with a gap so they read as a
    // grid, not tall bars). Fine/Medium/Coarse still scale the resolution.
    const pRows = Math.min(nBuckets, 140);
    const tCols = candles.length;
    const t0 = candles[0].t;
    const dur = candles[1].t - candles[0].t || 3.6e6;
    // Per-cell long/short so the hover tooltip can show the side + value; colour
    // uses the total (l + s).
    const gridL: number[][] = Array.from({ length: pRows }, () => Array(tCols).fill(0));
    const gridS: number[][] = Array.from({ length: pRows }, () => Array(tCols).fill(0));
    let peak = 0;
    for (const e of events) {
      const ts = Number(e.timestamp);
      let ti = Math.floor((ts - t0) / dur);
      if (ti < 0 || ti >= tCols) continue; // event outside the candle window
      let pi = Math.floor(((pMax - e.price) / (pMax - pMin)) * pRows); // row 0 = top (high price)
      if (pi < 0) pi = 0; if (pi >= pRows) pi = pRows - 1;
      if (/long/i.test(e.side)) gridL[pi][ti] += val(e); else gridS[pi][ti] += val(e);
      const tot = gridL[pi][ti] + gridS[pi][ti];
      if (tot > peak) peak = tot;
    }
    return { gridL, gridS, pRows, tCols, pMin, pMax, peak, candleT: candles.map((c) => c.t), dur };
  }, [candles, events, nBuckets, denom]);

  const fmtVal = (n: number) => (denom === 'usd' ? `$${formatCompact(n)}` : `${formatCompact(n)} ${coin}`);
  const fmtPrice = (n: number) => `$${formatCompact(n)}`;
  const totalLong = useMemo(() => events.filter((e) => /long/i.test(e.side)).reduce((s, e) => s + val(e), 0), [events, denom]);
  const totalShort = useMemo(() => events.filter((e) => !/long/i.test(e.side)).reduce((s, e) => s + val(e), 0), [events, denom]);

  return (
    <div className={embedded ? 'flex h-full flex-col' : 'bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4'}>
      {/* Toolbar — one clean row: controls left, live price right. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {!embedded && <h3 className="mr-1 text-base font-semibold text-[var(--text-primary)]">Liquidations</h3>}
        {!lockedCoin && (
          <div className="flex items-center gap-0.5 rounded-lg bg-[var(--bg-muted)] p-0.5">
            {COINS.map((c) => (
              <button key={c} onClick={() => setCoin(c)}
                className={cn('rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                  coin === c ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}>
                {c}
              </button>
            ))}
          </div>
        )}
        <Seg options={[['profile', 'Profile'], ['heatmap', 'Heatmap']]} value={mode} onChange={(v) => setMode(v as any)} />
        <Seg options={[['fine', 'Fine'], ['medium', 'Medium'], ['coarse', 'Coarse']]} value={gran} onChange={(v) => setGran(v as any)} />
        <Seg options={[['coin', coin], ['usd', 'USD']]} value={denom} onChange={(v) => setDenom(v as any)} />
        {price > 0 && (
          <span className="ml-auto text-[11px] text-[var(--role-content-subtle)]">Live <span className="font-semibold text-[var(--role-content)]">{fmtPrice(price)}</span></span>
        )}
      </div>

      {/* Legend chips */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <Legend color={LONG} label={`Long liq · ${fmtVal(totalLong)}`} />
        <Legend color={SHORT} label={`Short liq · ${fmtVal(totalShort)}`} />
      </div>

      {/* Body */}
      <div className={cn('mt-3', embedded ? 'min-h-0 flex-1' : 'h-[360px]')}>
        {loading && events.length === 0 ? (
          <Center>Loading…</Center>
        ) : events.length === 0 ? (
          <Center>No liquidations recorded for {coin} yet.</Center>
        ) : mode === 'profile' ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={profile} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="liqCumL" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={LONG} stopOpacity={0.16} /><stop offset="100%" stopColor={LONG} stopOpacity={0} /></linearGradient>
                <linearGradient id="liqCumS" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SHORT} stopOpacity={0.16} /><stop offset="100%" stopColor={SHORT} stopOpacity={0} /></linearGradient>
              </defs>
              <XAxis dataKey="price" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtPrice}
                tick={{ fill: 'var(--role-content-subtle)', fontSize: isMobile ? 9 : 11 }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis yAxisId="l" tick={{ fill: 'var(--role-content-subtle)', fontSize: isMobile ? 9 : 11 }} axisLine={false} tickLine={false}
                width={isMobile ? 40 : 52} tickFormatter={(v) => formatCompact(Number(v))} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: 'var(--role-content-subtle)', fontSize: isMobile ? 9 : 11 }} axisLine={false} tickLine={false}
                width={isMobile ? 40 : 52} tickFormatter={(v) => formatCompact(Number(v))} />
              {/* Red (long) / green (short) background tint split at the live price. */}
              {price > profile[0]?.price && <ReferenceArea yAxisId="l" x1={profile[0].price} x2={price} fill={LONG} fillOpacity={0.06} strokeOpacity={0} />}
              {price < profile[profile.length - 1]?.price && <ReferenceArea yAxisId="l" x1={price} x2={profile[profile.length - 1].price} fill={SHORT} fillOpacity={0.06} strokeOpacity={0} />}
              <Tooltip contentStyle={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}
                labelFormatter={(p) => fmtPrice(Number(p))}
                formatter={(v: number, n: string) => [denom === 'usd' ? `$${formatCompact(Number(v))}` : `${formatCompact(Number(v))} ${coin}`,
                  ({ long: 'Long liq', short: 'Short liq', cumLong: 'Cumulative long', cumShort: 'Cumulative short' } as any)[n] || n]} />
              {/* Cumulative curves with faint area fill (behind the bars). */}
              <Area yAxisId="r" type="monotone" dataKey="cumLong" stroke={LONG} strokeWidth={1.5} fill="url(#liqCumL)" dot={false} isAnimationActive={false} />
              <Area yAxisId="r" type="monotone" dataKey="cumShort" stroke={SHORT} strokeWidth={1.5} fill="url(#liqCumS)" dot={false} isAnimationActive={false} />
              <Bar yAxisId="l" dataKey="long" fill={LONG} isAnimationActive={false} />
              <Bar yAxisId="l" dataKey="short" fill={SHORT} isAnimationActive={false} />
              {price > 0 && <ReferenceLine yAxisId="l" x={price} stroke="var(--role-content)" strokeDasharray="4 4" strokeOpacity={0.7}
                label={{ value: `Current: ${fmtPrice(price)}`, position: 'insideBottom', fill: 'var(--role-content)', fontSize: 10 }} />}
            </ComposedChart>
          </ResponsiveContainer>
        ) : heat ? (
          <HeatmapCandles {...heat} candles={candles} price={price} denomCoin={coin} denom={denom} fmtVal={fmtVal} fmtPrice={fmtPrice} />
        ) : (
          <Center>Loading price data for the heatmap…</Center>
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[var(--role-content-subtle)]">
        Built from BULK&apos;s recorded liquidation events (real, not projected). Fills in as more liquidations occur.
      </p>
    </div>
  );
}

// Combined liquidation heatmap + candlesticks (HyperDash-style): the heat FIELD
// is the background, the coin's real candles are drawn on top, both sharing the
// price (Y) and time (X) axes. Rendered as one SVG stretched to the container
// (preserveAspectRatio none), with the price axis alongside.
const BASE = 'rgb(12,9,24)';
function heatColor(v: number, peak: number) {
  if (v <= 0) return BASE;
  const t = 0.12 + 0.88 * Math.min(1, Math.log1p(v) / Math.log1p(peak || 1));
  const stops = [[26, 16, 48], [80, 18, 90], [190, 55, 60], [245, 140, 40], [250, 230, 130]];
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const f = t * (stops.length - 1) - seg;
  const [a, b] = [stops[seg], stops[seg + 1]];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

interface Tip { left: number; top: number; timeLabel: string; priceLabel: string; long: number; short: number; }

function HeatmapCandles({ gridL, gridS, pRows, pMin, pMax, peak, candles, price, candleT, dur, denom, denomCoin }: {
  gridL: number[][]; gridS: number[][]; pRows: number; pMin: number; pMax: number; peak: number;
  candles: Candle[]; price: number; candleT: number[]; dur: number; denom: 'coin' | 'usd'; denomCoin: string;
  fmtVal?: (n: number) => string; fmtPrice?: (n: number) => string;
}) {
  // Interactive: candles via lightweight-charts (pan/zoom/scale), heat field on a
  // canvas BEHIND the transparent chart, re-aligned on every range change; a
  // hover tooltip reads the cell under the cursor via the chart's coordinate API;
  // a vertical colour-scale legend sits alongside.
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const fmt = (n: number) => (denom === 'usd' ? `$${formatCompact(n)}` : `${formatCompact(n)} ${denomCoin}`);
  const fmtP = (n: number) => `$${formatCompact(n)}`;

  useEffect(() => {
    const container = wrapRef.current, canvas = canvasRef.current;
    if (!container || !canvas || candles.length < 2) return;

    const cssVar = (expr: string, fb: string) => {
      const s = document.createElement('span'); s.style.color = expr; s.style.display = 'none';
      document.body.appendChild(s); const c = getComputedStyle(s).color; document.body.removeChild(s);
      return c || fb;
    };
    const pos = cssVar('var(--pos)', 'rgb(33,192,122)');
    const neg = cssVar('var(--neg)', 'rgb(229,72,77)');
    const text = cssVar('var(--role-content-subtle)', 'rgb(138,138,138)');
    const border = cssVar('var(--role-line)', 'rgba(128,118,120,0.24)');
    const priceLineCol = cssVar('var(--role-content)', 'rgb(230,230,230)');

    const chart = createChart(container, {
      width: container.clientWidth || 600,
      height: container.clientHeight || 360,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });
    const series = chart.addCandlestickSeries({
      upColor: pos, downColor: neg, borderUpColor: pos, borderDownColor: neg, wickUpColor: pos, wickDownColor: neg,
    });
    series.setData(candles.map((c) => ({ time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    chart.timeScale().fitContent();
    if (price > 0) {
      try { series.createPriceLine({ price, color: priceLineCol, lineWidth: 1, lineStyle: 2, axisLabelVisible: true }); } catch { /* ok */ }
    }

    const times = candles.map((c) => Math.floor(c.t / 1000) as UTCTimestamp);
    const tCols = candles.length;

    const sizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth, h = container.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d'); if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = () => {
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const w = container.clientWidth, h = container.clientHeight;
      // Transparent background so the card surface shows through — matches the
      // default chart. Only cells with liquidations are painted.
      ctx.clearRect(0, 0, w, h);
      const ts = chart.timeScale();
      const bs = Math.max(1, ts.options().barSpacing || 6);
      // Small gap so cells read as discrete squares, not merged vertical bars.
      const gap = bs > 4 ? 1 : 0;
      for (let ti = 0; ti < tCols; ti++) {
        const x = ts.timeToCoordinate(times[ti]); if (x == null) continue;
        for (let pi = 0; pi < pRows; pi++) {
          const v = gridL[pi][ti] + gridS[pi][ti]; if (v <= 0) continue;
          const pTop = pMax - (pi / pRows) * (pMax - pMin);
          const pBot = pMax - ((pi + 1) / pRows) * (pMax - pMin);
          const yTop = series.priceToCoordinate(pTop), yBot = series.priceToCoordinate(pBot);
          if (yTop == null || yBot == null) continue;
          const cellH = Math.abs(yBot - yTop);
          ctx.fillStyle = heatColor(v, peak);
          ctx.fillRect(x - bs / 2 + gap, Math.min(yTop, yBot) + gap, Math.max(1, bs - gap * 2), Math.max(1, cellH - gap));
        }
      }
    };
    let raf = 0;
    const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };

    // Hover → find the cell under the cursor and show its long/short liq.
    const onMove = (e: PointerEvent) => {
      redraw();
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left, yPx = e.clientY - rect.top;
      const p = series.coordinateToPrice(yPx);
      const logical = chart.timeScale().coordinateToLogical(x);
      if (p == null || logical == null) { setTip(null); return; }
      const ti = Math.round(logical);
      if (ti < 0 || ti >= tCols) { setTip(null); return; }
      let pi = Math.floor(((pMax - p) / (pMax - pMin)) * pRows);
      if (pi < 0 || pi >= pRows) { setTip(null); return; }
      const l = gridL[pi][ti], s = gridS[pi][ti];
      if (l + s <= 0) { setTip(null); return; }
      const d = new Date(candleT[ti]);
      setTip({
        left: x, top: yPx,
        timeLabel: d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
        priceLabel: fmtP(p), long: l, short: s,
      });
    };
    const onLeave = () => setTip(null);

    sizeCanvas(); redraw();
    const t1 = window.setTimeout(redraw, 60);
    const t2 = window.setTimeout(redraw, 260);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => { chart.applyOptions({ width: container.clientWidth, height: container.clientHeight }); sizeCanvas(); redraw(); });
    ro.observe(container);
    container.addEventListener('wheel', redraw, { passive: true });
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', redraw);
    container.addEventListener('pointerleave', onLeave);

    return () => {
      clearTimeout(t1); clearTimeout(t2); cancelAnimationFrame(raf); ro.disconnect();
      container.removeEventListener('wheel', redraw);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', redraw);
      container.removeEventListener('pointerleave', onLeave);
      chart.remove();
    };
  }, [gridL, gridS, pRows, pMin, pMax, peak, price, candles, candleT, denom, denomCoin]);

  // Legend gradient (matches the heat ramp).
  const legendStops = [250, 200, 150, 100, 60, 30, 0].map((v) => heatColor((v / 250) * peak, peak));
  return (
    <div className="flex h-full w-full gap-2">
      {/* Colour-scale legend */}
      <div className="flex w-14 shrink-0 flex-col items-start justify-between py-0.5 text-[9px] tabular-nums text-[var(--role-content-subtle)]">
        <span>{fmt(peak)}</span>
        <div className="my-1 w-3 flex-1 rounded-sm" style={{ background: `linear-gradient(to bottom, ${legendStops.join(',')})` }} />
        <span>{denom === 'usd' ? '$0' : `0 ${denomCoin}`}</span>
      </div>
      {/* Chart + heat + tooltip */}
      <div className="relative min-w-0 flex-1">
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0" />
        <div ref={wrapRef} className="absolute inset-0 z-10" />
        {tip && (
          <div
            className="pointer-events-none absolute z-20 rounded-lg border border-[var(--role-line)] bg-[var(--bg-overlay)] px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur-md"
            style={{ left: Math.min(tip.left + 12, (wrapRef.current?.clientWidth || 300) - 150), top: Math.max(4, tip.top - 60) }}
          >
            <div className="mb-1 text-[var(--role-content-subtle)]">{tip.timeLabel}</div>
            <div className="flex items-center justify-between gap-4"><span className="text-[var(--role-content-subtle)]">Price</span><span className="font-semibold text-[var(--role-content)]">{tip.priceLabel}</span></div>
            {tip.long > 0 && <div className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--neg)' }} />Long liq</span><span className="font-semibold text-[var(--neg)]">{fmt(tip.long)}</span></div>}
            {tip.short > 0 && <div className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--pos)' }} />Short liq</span><span className="font-semibold text-[var(--pos)]">{fmt(tip.short)}</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Seg({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-[var(--bg-muted)] p-0.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={cn('rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
            value === v ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[var(--role-content-subtle)]">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}
    </span>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-center text-[12px] text-[var(--role-content-subtle)]">{children}</div>;
}
