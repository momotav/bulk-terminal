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

import { useEffect, useMemo, useState } from 'react';
import { Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analytics, cn, formatCompact, type Candle } from '@/lib/api';
import { withNetwork } from '@/lib/network';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { useIsMobile } from '@/hooks/useIsMobile';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.bulkstats.com';
const COINS = ['BTC', 'ETH', 'SOL', 'HYPE', 'PUMP', 'ZEC'];
const GRAN = { fine: 120, medium: 60, coarse: 30 } as const;
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
    const pRows = Math.min(nBuckets, 60);
    const tCols = candles.length;
    const t0 = candles[0].t;
    const dur = candles[1].t - candles[0].t || 3.6e6;
    const grid: number[][] = Array.from({ length: pRows }, () => Array(tCols).fill(0));
    let peak = 0;
    for (const e of events) {
      const ts = Number(e.timestamp);
      let ti = Math.floor((ts - t0) / dur);
      if (ti < 0 || ti >= tCols) continue; // event outside the candle window
      let pi = Math.floor(((pMax - e.price) / (pMax - pMin)) * pRows); // row 0 = top (high price)
      if (pi < 0) pi = 0; if (pi >= pRows) pi = pRows - 1;
      grid[pi][ti] += val(e);
      if (grid[pi][ti] > peak) peak = grid[pi][ti];
    }
    return { grid, pRows, tCols, pMin, pMax, peak };
  }, [candles, events, nBuckets, denom]);

  const fmtVal = (n: number) => (denom === 'usd' ? `$${formatCompact(n)}` : `${formatCompact(n)} ${coin}`);
  const fmtPrice = (n: number) => `$${formatCompact(n)}`;
  const totalLong = useMemo(() => events.filter((e) => /long/i.test(e.side)).reduce((s, e) => s + val(e), 0), [events, denom]);
  const totalShort = useMemo(() => events.filter((e) => !/long/i.test(e.side)).reduce((s, e) => s + val(e), 0), [events, denom]);

  return (
    <div className={embedded ? 'flex h-full flex-col' : 'bg-[var(--role-surface)] rounded-lg border border-[var(--border-color)] p-4'}>
      {/* Header: coin picker (standalone) + mode / granularity / denom toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!embedded && <h3 className="text-base font-semibold text-[var(--text-primary)]">Liquidations</h3>}
          {/* Coin picker only when standalone; embedded is locked to the modal's coin. */}
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
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Seg options={[['profile', 'Profile'], ['heatmap', 'Heatmap']]} value={mode} onChange={(v) => setMode(v as any)} />
          <Seg options={[['fine', 'Fine'], ['medium', 'Medium'], ['coarse', 'Coarse']]} value={gran} onChange={(v) => setGran(v as any)} />
          <Seg options={[['coin', coin], ['usd', 'USD']]} value={denom} onChange={(v) => setDenom(v as any)} />
        </div>
      </div>

      {/* Legend + live price */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <Legend color={LONG} label={`Long liq · ${fmtVal(totalLong)}`} />
        <Legend color={SHORT} label={`Short liq · ${fmtVal(totalShort)}`} />
        {price > 0 && <span className="ml-auto text-[var(--role-content-subtle)]">Live <span className="font-semibold text-[var(--role-content)]">{fmtPrice(price)}</span></span>}
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
              <XAxis dataKey="price" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtPrice}
                tick={{ fill: 'var(--role-content-subtle)', fontSize: isMobile ? 9 : 11 }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis yAxisId="l" tick={{ fill: 'var(--role-content-subtle)', fontSize: isMobile ? 9 : 11 }} axisLine={false} tickLine={false}
                width={isMobile ? 40 : 52} tickFormatter={(v) => formatCompact(Number(v))} />
              <YAxis yAxisId="r" orientation="right" tick={{ fill: 'var(--role-content-subtle)', fontSize: isMobile ? 9 : 11 }} axisLine={false} tickLine={false}
                width={isMobile ? 40 : 52} tickFormatter={(v) => formatCompact(Number(v))} />
              <Tooltip contentStyle={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}
                labelFormatter={(p) => fmtPrice(Number(p))}
                formatter={(v: number, n: string) => [denom === 'usd' ? `$${formatCompact(Number(v))}` : `${formatCompact(Number(v))} ${coin}`,
                  ({ long: 'Long liq', short: 'Short liq', cumLong: 'Cumulative long', cumShort: 'Cumulative short' } as any)[n] || n]} />
              <Bar yAxisId="l" dataKey="long" fill={LONG} isAnimationActive={false} />
              <Bar yAxisId="l" dataKey="short" fill={SHORT} isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="cumLong" stroke={LONG} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="cumShort" stroke={SHORT} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              {price > 0 && <ReferenceLine yAxisId="l" x={price} stroke="var(--role-content)" strokeDasharray="4 4"
                label={{ value: fmtPrice(price), position: 'top', fill: 'var(--role-content)', fontSize: 10 }} />}
            </ComposedChart>
          </ResponsiveContainer>
        ) : heat ? (
          <HeatmapCandles {...heat} candles={candles} price={price} fmtVal={fmtVal} fmtPrice={fmtPrice} />
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

function HeatmapCandles({ grid, pRows, tCols, pMin, pMax, peak, candles, price, fmtVal, fmtPrice }: {
  grid: number[][]; pRows: number; tCols: number; pMin: number; pMax: number; peak: number;
  candles: Candle[]; price: number; fmtVal: (n: number) => string; fmtPrice: (n: number) => string;
}) {
  // Logical coordinate space; SVG stretches to fill (cells become wide, like HD).
  const W = tCols, H = 1000;
  const y = (p: number) => (1 - (p - pMin) / (pMax - pMin)) * H;
  const rowH = H / pRows;
  const green = 'var(--pos)', red = 'var(--neg)';
  const bodyW = 0.62, halfB = bodyW / 2;

  const priceLabels = [pMax, pMin + (pMax - pMin) * 0.75, (pMax + pMin) / 2, pMin + (pMax - pMin) * 0.25, pMin];

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded" style={{ background: BASE }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Heat field */}
          {grid.flatMap((rowArr, pi) =>
            rowArr.map((v, ti) => v > 0 ? (
              <rect key={`h${pi}-${ti}`} x={ti} y={pi * rowH} width={1} height={rowH} fill={heatColor(v, peak)} shapeRendering="crispEdges" />
            ) : null),
          )}
          {/* Candles */}
          {candles.map((c, i) => {
            const up = c.c >= c.o;
            const col = up ? green : red;
            const cx = i + 0.5;
            const yO = y(c.o), yC = y(c.c);
            const top = Math.min(yO, yC), h = Math.max(1, Math.abs(yO - yC));
            return (
              <g key={`c${i}`}>
                <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={0.09} vectorEffect="non-scaling-stroke" />
                <rect x={cx - halfB} y={top} width={bodyW} height={h} fill={col} />
              </g>
            );
          })}
          {/* Live price line */}
          {price > pMin && price < pMax && (
            <line x1={0} x2={W} y1={y(price)} y2={y(price)} stroke="var(--role-content)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity={0.6} />
          )}
        </svg>
      </div>
      {/* Price axis */}
      <div className="flex w-12 shrink-0 flex-col justify-between py-0.5 pl-1 text-left text-[9px] tabular-nums text-[var(--role-content-subtle)]">
        {priceLabels.map((p, i) => <span key={i}>{fmtPrice(p)}</span>)}
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
