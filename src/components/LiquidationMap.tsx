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
import { createChart, ColorType, type UTCTimestamp } from 'lightweight-charts';
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

  return (
    <div className={embedded ? 'flex h-full flex-col' : 'bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4'}>
      {/* Toolbar — one clean row: controls left, live price right. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {!embedded && <h3 className="mr-1 text-base font-semibold text-[var(--text-primary)]">Liquidations</h3>}
        {!lockedCoin && (
          <div className="flex items-center gap-0.5 rounded-lg bg-[var(--bg-muted)] p-0.5">
            {COINS.map((c) => (
              <button key={c} onClick={() => setCoin(c)}
                className={cn('rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
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
          <span className="ml-auto text-xs text-[var(--role-content-subtle)]">Live <span className="font-semibold text-[var(--role-content)]">{fmtPrice(price)}</span></span>
        )}
      </div>

      {/* Body */}
      <div className={cn('mt-3', embedded ? 'min-h-0 flex-1' : 'h-[360px]')}>
        {loading && events.length === 0 ? (
          <Center>Loading…</Center>
        ) : events.length === 0 ? (
          <Center>No liquidations recorded for {coin} yet.</Center>
        ) : mode === 'profile' ? (
          <ProfileChart profile={profile} price={price} denom={denom} coin={coin} />
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
      try { series.createPriceLine({ price, color: priceLineCol, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Live' }); } catch { /* ok */ }
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
          className={cn('rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
            value === v ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}>
          {label}
        </button>
      ))}
    </div>
  );
}

interface PBucket { price: number; long: number; short: number; cumLong: number; cumShort: number; }
interface PTip { left: number; top: number; priceLabel: string; side: 'long' | 'short'; notional: number; cumulative: number; }

// ProfileChart — custom canvas liquidation profile (HyperDash-style): per-price
// notional bars (long red left / short green right), cumulative curves with
// faint area fills emanating from the live price, and a current-price marker.
// Zoomable: wheel zooms the price axis around the cursor, drag pans.
function ProfileChart({ profile, price, denom, coin }: {
  profile: PBucket[]; price: number; denom: 'coin' | 'usd'; coin: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<PTip | null>(null);
  const dragRef = useRef<{ x: number; range: [number, number] } | null>(null);
  // Displayed range (animated) and the target it eases toward — refs so zoom
  // glides frame-by-frame without a React re-render per step (the "slideshow").
  const curRef = useRef<[number, number] | null>(null);
  const targetRef = useRef<[number, number] | null>(null);

  const fullMin = profile.length ? profile[0].price : 0;
  const fullMax = profile.length ? profile[profile.length - 1].price : 1;

  useEffect(() => {
    const container = wrapRef.current, canvas = canvasRef.current;
    if (!container || !canvas || profile.length === 0) return;
    curRef.current = [fullMin, fullMax];
    targetRef.current = [fullMin, fullMax];
    const cssVar = (expr: string, fb: string) => {
      const s = document.createElement('span'); s.style.color = expr; s.style.display = 'none';
      document.body.appendChild(s); const c = getComputedStyle(s).color; document.body.removeChild(s); return c || fb;
    };
    const red = cssVar('var(--neg)', 'rgb(229,72,77)');
    const green = cssVar('var(--pos)', 'rgb(33,192,122)');
    const axis = cssVar('var(--role-content-subtle)', 'rgb(138,138,138)');
    const line = cssVar('var(--role-line-subtle)', 'rgba(128,118,120,0.14)');
    const accent = cssVar('var(--accent)', 'rgb(240,185,11)'); // current-price marker
    const rgba = (rgb: string, a: number) => rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`);
    const padL = 54, padR = 54, padB = 22, padT = 8;
    const fmt = (n: number) => (denom === 'usd' ? `$${formatCompact(n)}` : `${formatCompact(n)} ${coin}`);
    const fmtP = (n: number) => `$${formatCompact(n)}`;

    const sizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth, h = container.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d'); if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = () => {
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      const w = container.clientWidth, h = container.clientHeight;
      const plotW = w - padL - padR, plotH = h - padT - padB;
      ctx.clearRect(0, 0, w, h);
      const cr = curRef.current; if (!cr) return;
      const [vMin, vMax] = cr;
      const xOf = (p: number) => padL + ((p - vMin) / (vMax - vMin)) * plotW;
      // Visible buckets + scales.
      const vis = profile.filter((b) => b.price >= vMin && b.price <= vMax);
      let maxN = 0, maxC = 0;
      for (const b of vis) { maxN = Math.max(maxN, b.long, b.short); maxC = Math.max(maxC, b.cumLong, b.cumShort); }
      maxN = maxN || 1; maxC = maxC || 1;
      const yN = (v: number) => padT + plotH - (v / maxN) * plotH;
      const yC = (v: number) => padT + plotH - (v / maxC) * plotH;
      const baseY = padT + plotH;
      // Grid lines.
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) { const y = padT + (plotH * i) / 4; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); }
      // Cumulative area fills (faint) + curves. Longs left of price, shorts right.
      const drawCurve = (key: 'cumLong' | 'cumShort', col: string, side: 'l' | 'r') => {
        const pts = vis.filter((b) => side === 'l' ? b.price <= price : b.price >= price);
        if (pts.length < 2) return;
        // area
        ctx.beginPath(); ctx.moveTo(xOf(pts[0].price), baseY);
        for (const b of pts) ctx.lineTo(xOf(b.price), yC(b[key]));
        ctx.lineTo(xOf(pts[pts.length - 1].price), baseY); ctx.closePath();
        ctx.fillStyle = rgba(col, 0.1); ctx.fill();
        // line
        ctx.beginPath(); ctx.moveTo(xOf(pts[0].price), yC(pts[0][key]));
        for (const b of pts) ctx.lineTo(xOf(b.price), yC(b[key]));
        ctx.strokeStyle = col; ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.stroke();
      };
      drawCurve('cumLong', red, 'l');
      drawCurve('cumShort', green, 'r');
      // Bars.
      const bw = Math.max(1, Math.min(6, (plotW / Math.max(1, vis.length)) * 0.6));
      for (const b of vis) {
        if (b.long > 0) { ctx.fillStyle = red; const x = xOf(b.price); ctx.fillRect(x - bw / 2, yN(b.long), bw, baseY - yN(b.long)); }
        if (b.short > 0) { ctx.fillStyle = green; const x = xOf(b.price); ctx.fillRect(x - bw / 2, yN(b.short), bw, baseY - yN(b.short)); }
      }
      // Current price line + pill (accent, not white).
      if (price >= vMin && price <= vMax) {
        const x = xOf(price);
        ctx.strokeStyle = accent; ctx.globalAlpha = 0.85; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, baseY); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      // Axes labels.
      ctx.fillStyle = axis; ctx.font = '10px system-ui'; ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) { const v = (maxN * (4 - i)) / 4; ctx.fillText(formatCompact(v), padL - 4, padT + (plotH * i) / 4); }
      ctx.textAlign = 'left';
      for (let i = 0; i <= 4; i++) { const v = (maxC * (4 - i)) / 4; ctx.fillText(formatCompact(v), w - padR + 4, padT + (plotH * i) / 4); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let i = 0; i <= 4; i++) { const p = vMin + ((vMax - vMin) * i) / 4; ctx.fillText(fmtP(p), padL + (plotW * i) / 4, baseY + 5); }
      // Current pill label (accent background, dark text).
      if (price >= vMin && price <= vMax) {
        const x = xOf(price); const label = `Current: ${fmtP(price)}`; ctx.font = '600 10px system-ui';
        const tw = ctx.measureText(label).width + 10; ctx.fillStyle = accent;
        ctx.fillRect(Math.min(Math.max(x - tw / 2, padL), w - padR - tw), baseY + 3, tw, 15);
        ctx.fillStyle = cssVar('var(--accent-text)', '#1a1a1a'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, Math.min(Math.max(x, padL + tw / 2), w - padR - tw / 2), baseY + 10);
      }
    };
    // Animation: ease the displayed range toward the target each frame so zoom
    // glides instead of snapping. One rAF loop; stops when settled.
    let raf = 0;
    const EASE = 0.22;
    const tick = () => {
      const cur = curRef.current!, tgt = targetRef.current!;
      const dMin = tgt[0] - cur[0], dMax = tgt[1] - cur[1];
      const span = Math.max(1e-9, cur[1] - cur[0]);
      if (Math.abs(dMin) / span < 0.0006 && Math.abs(dMax) / span < 0.0006) {
        curRef.current = [tgt[0], tgt[1]]; draw(); raf = 0; return;
      }
      curRef.current = [cur[0] + dMin * EASE, cur[1] + dMax * EASE];
      draw();
      raf = requestAnimationFrame(tick);
    };
    const animate = () => { if (!raf) raf = requestAnimationFrame(tick); };

    sizeCanvas(); draw();
    const ro = new ResizeObserver(() => { sizeCanvas(); draw(); }); ro.observe(container);

    // Wheel = smooth zoom toward a target range (eased by the loop).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const plotW = container.clientWidth - padL - padR;
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - padL) / plotW));
      const [tMin, tMax] = targetRef.current!; const span = tMax - tMin;
      const cursor = tMin + frac * span;
      const factor = e.deltaY > 0 ? 1.18 : 0.82;
      let nMin = cursor - (cursor - tMin) * factor;
      let nMax = cursor + (tMax - cursor) * factor;
      nMin = Math.max(fullMin, nMin); nMax = Math.min(fullMax, nMax);
      if (nMax - nMin > (fullMax - fullMin) * 0.02) { targetRef.current = [nMin, nMax]; animate(); }
    };
    // Drag = pan, applied directly (1:1) for responsiveness.
    const onDown = (e: PointerEvent) => { dragRef.current = { x: e.clientX, range: [...(curRef.current as [number, number])] }; };
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        const plotW = container.clientWidth - padL - padR;
        const [sMin, sMax] = dragRef.current.range; const span = sMax - sMin;
        const dx = ((e.clientX - dragRef.current.x) / plotW) * span;
        let nMin = sMin - dx, nMax = sMax - dx;
        if (nMin < fullMin) { nMax += fullMin - nMin; nMin = fullMin; }
        if (nMax > fullMax) { nMin -= nMax - fullMax; nMax = fullMax; }
        curRef.current = [Math.max(fullMin, nMin), Math.min(fullMax, nMax)];
        targetRef.current = curRef.current;
        draw();
        return;
      }
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left; const plotW = container.clientWidth - padL - padR;
      const [vMin, vMax] = curRef.current!; const p = vMin + ((x - padL) / plotW) * (vMax - vMin);
      let best: PBucket | null = null, bd = Infinity;
      for (const b of profile) { const d = Math.abs(b.price - p); if (d < bd) { bd = d; best = b; } }
      if (!best || (best.long <= 0 && best.short <= 0)) { setTip(null); return; }
      const side: 'long' | 'short' = best.long >= best.short ? 'long' : 'short';
      setTip({ left: x, top: e.clientY - rect.top, priceLabel: fmtP(best.price), side, notional: side === 'long' ? best.long : best.short, cumulative: side === 'long' ? best.cumLong : best.cumShort });
    };
    const onUp = () => { dragRef.current = null; };
    const onLeave = () => { dragRef.current = null; setTip(null); };
    const onDbl = () => { targetRef.current = [fullMin, fullMax]; animate(); }; // reset zoom
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    container.addEventListener('pointerleave', onLeave);
    container.addEventListener('dblclick', onDbl);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('dblclick', onDbl);
    };
  }, [profile, price, denom, coin, fullMin, fullMax]);

  const fmt = (n: number) => (denom === 'usd' ? `$${formatCompact(n)}` : `${formatCompact(n)} ${coin}`);
  return (
    <div ref={wrapRef} className="relative h-full w-full cursor-crosshair select-none" style={{ touchAction: 'none' }}>
      <canvas ref={canvasRef} className="absolute inset-0" />
      {tip && (
        <div className="pointer-events-none absolute z-20 rounded-lg border border-[var(--role-line)] bg-[var(--bg-overlay)] px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur-md"
          style={{ left: Math.min(tip.left + 12, (wrapRef.current?.clientWidth || 300) - 150), top: Math.max(4, tip.top - 58) }}>
          <div className="mb-1 text-[var(--role-content-subtle)]">{tip.priceLabel}</div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: tip.side === 'long' ? LONG : SHORT }} />{tip.side === 'long' ? 'Long liq' : 'Short liq'}</span>
            <span className="font-semibold" style={{ color: tip.side === 'long' ? LONG : SHORT }}>{fmt(tip.notional)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-4 text-[var(--role-content-subtle)]">
            <span>Cumulative</span><span className="font-medium text-[var(--role-content)]">{fmt(tip.cumulative)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-center text-[12px] text-[var(--role-content-subtle)]">{children}</div>;
}
