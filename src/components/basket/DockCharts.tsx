'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/lib/api';
import type { BasketLeg } from '@/lib/basket';
import { intervalSeconds, subscribePrice } from './live';

const resolve = (expr: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const probe = document.createElement('span');
  probe.style.color = expr; probe.style.display = 'none';
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c || fallback;
};

/** Re-renders when the site theme or palette changes, so charts repaint in the new colours. */
function useThemeKey(): string {
  const [k, setK] = useState('');
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setK(`${el.getAttribute('data-theme')}|${el.getAttribute('data-palette')}|${el.className}`);
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'class'] });
    return () => mo.disconnect();
  }, []);
  return k;
}

function baseOptions(el: HTMLElement) {
  const text = resolve('var(--text-tertiary)', '#807678');
  const line = resolve('var(--border-color)', 'rgba(84,74,76,0.35)');
  return {
    width: el.clientWidth || 400,
    height: el.clientHeight || 200,
    localization: { locale: 'en-US' },
    layout: { attributionLogo: false, background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 10, fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { visible: false }, horzLines: { color: line.replace(/rgb\(([^)]+)\)/, 'rgba($1,0.35)') } },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: false } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 2 },
    // Wheel/pinch zooms time; dragging an axis stretches it (price or time); double-click an axis resets it.
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  };
}

function useResize(ref: React.RefObject<HTMLDivElement | null>, chart: React.MutableRefObject<IChartApi | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => chart.current?.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, chart]);
}

type Bar = { time: UTCTimestamp; open: number; high: number; low: number; close: number };

/**
 * A market's candles that keep moving: the last candle follows every trade print
 * and a new one starts when the interval rolls over. The chart is built once per
 * market and interval; the minute refresh swaps the data underneath without
 * resetting where the viewer has zoomed or scrolled to.
 */
export function DockCandleChart({ candles, coin, interval }: { candles: Candle[]; coin?: string; interval?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const liveBar = useRef<Bar | null>(null);
  const fitted = useRef(false);
  const theme = useThemeKey();
  useResize(ref, chart);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = createChart(el, baseOptions(el));
    chart.current = c;
    const pos = resolve('var(--pos)', '#21C07A'); const neg = resolve('var(--neg)', '#E5484D');
    series.current = c.addCandlestickSeries({ upColor: pos, downColor: neg, borderUpColor: pos, borderDownColor: neg, wickUpColor: pos, wickDownColor: neg });
    fitted.current = false;
    return () => { c.remove(); chart.current = null; series.current = null; liveBar.current = null; };
  }, [theme, coin, interval]);

  useEffect(() => {
    const s = series.current; const c = chart.current;
    if (!s || !c || !candles.length) return;
    const seen = new Set<number>();
    const bars: Bar[] = candles.flatMap((k) => {
      const t = Math.floor(k.t / 1000);
      if (seen.has(t)) return [];
      seen.add(t);
      return [{ time: t as UTCTimestamp, open: k.o, high: k.h, low: k.l, close: k.c }];
    });
    // Keep the live candle if it is newer than (or the same as) the refreshed data's last bar.
    const lb = liveBar.current;
    const last = bars[bars.length - 1];
    if (lb && last && lb.time >= last.time) {
      if (lb.time === last.time) bars[bars.length - 1] = { ...last, high: Math.max(last.high, lb.high), low: Math.min(last.low, lb.low), close: lb.close };
      else bars.push(lb);
    }
    const view = fitted.current ? c.timeScale().getVisibleLogicalRange() : null;
    s.setData(bars);
    liveBar.current = bars[bars.length - 1] ?? null;
    if (view) c.timeScale().setVisibleLogicalRange(view);
    else { c.timeScale().fitContent(); fitted.current = true; }
  }, [candles, theme, coin, interval]);

  useEffect(() => {
    if (!coin) return;
    const step = intervalSeconds(interval ?? '1h');
    return subscribePrice(coin, ({ price, ts }) => {
      const s = series.current; const lb = liveBar.current;
      if (!s || !lb) return; // wait for the history, or a lone candle flashes on an empty chart
      const bucket = (Math.floor(ts / 1000 / step) * step) as UTCTimestamp;
      try {
        if (bucket > lb.time) liveBar.current = { time: bucket, open: lb.close, high: Math.max(lb.close, price), low: Math.min(lb.close, price), close: price };
        else if (bucket === lb.time) liveBar.current = { ...lb, high: Math.max(lb.high, price), low: Math.min(lb.low, price), close: price };
        else return; // a late print for an older candle
        s.update(liveBar.current);
      } catch { /* out-of-order print: never break the stream */ }
    });
  }, [coin, interval, theme]);

  return <div ref={ref} className="absolute inset-0" />;
}

/**
 * The basket's return over the charts' window: each leg's price move from the first
 * shared candle, weighted, with shorts counted the other way. What the basket would
 * have made, before fees and funding, held over the period on screen.
 */
export function basketReturn(legs: BasketLeg[], series: Record<string, Candle[]>): { t: number; v: number }[] {
  // Every leg or nothing: a basket drawn from the legs that happened to load is a different basket.
  const active = legs.filter((l) => l.weight > 0);
  if (!active.length || active.some((l) => !series[l.coin]?.length)) return [];
  const total = active.reduce((a, l) => a + l.weight, 0);
  const maps = active.map((l) => new Map(series[l.coin].map((c) => [c.t, c.c])));
  const times = series[active[0].coin].map((c) => c.t).filter((t) => maps.every((m) => m.has(t)));
  if (times.length < 2) return [];
  const base = maps.map((m) => m.get(times[0])!);
  return times.map((t) => ({
    t,
    v: active.reduce((a, l, i) => a + (l.side === 'long' ? 1 : -1) * (l.weight / total) * (maps[i].get(t)! / base[i] - 1), 0) * 100,
  }));
}

export function BasketReturnChart({ points }: { points: { t: number; v: number }[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const theme = useThemeKey();
  useResize(ref, chart);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length < 2) return;
    // A small chart inside a scrolling panel: the wheel scrolls the panel, it doesn't zoom here.
    const c = createChart(el, { ...baseOptions(el), rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.15 } },
      handleScroll: false, handleScale: false });
    chart.current = c;
    const pos = resolve('var(--pos)', '#21C07A'); const neg = resolve('var(--neg)', '#E5484D');
    const fade = (rgb: string, a: number) => rgb.replace(/rgba?\(([^,]+),([^,]+),([^,)]+).*\)/, `rgba($1,$2,$3,${a})`);
    const s = c.addBaselineSeries({
      baseValue: { type: 'price', price: 0 },
      topLineColor: pos, topFillColor1: fade(pos, 0.28), topFillColor2: fade(pos, 0.02),
      bottomLineColor: neg, bottomFillColor1: fade(neg, 0.02), bottomFillColor2: fade(neg, 0.28),
      lineWidth: 2, priceFormat: { type: 'custom', formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, minMove: 0.01 },
    });
    s.setData(points.map((p) => ({ time: Math.floor(p.t / 1000) as UTCTimestamp, value: p.v })));
    c.timeScale().fitContent();
    return () => { c.remove(); chart.current = null; };
  }, [points, theme]);

  return <div ref={ref} className="absolute inset-0" />;
}
