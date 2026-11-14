'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { analytics, formatNumber } from '@/lib/api';
import { clampWicks, dropFillers } from '@/lib/candles';

// The market around a single fill or order: candles for the minutes either side,
// each fill as the same B/S marker the observe chart uses (pinned to its exact time
// and price), the order's price as a dashed level. Fills the right side of the
// trade and order pages.

export interface ExecMark { t: number; price: number; buy: boolean; size?: number; coin?: string }

const css = (expr: string, fallback: string) => {
  if (typeof document === 'undefined') return fallback;
  const el = document.createElement('span'); el.style.color = expr; el.style.display = 'none';
  document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove();
  return c || fallback;
};

/** Finest interval that keeps the window to a readable number of bars. */
function pick(spanMs: number): [string, number] {
  const ivs: [string, number][] = [['1m', 60e3], ['5m', 300e3], ['15m', 900e3], ['1h', 3600e3], ['4h', 14400e3], ['1d', 86400e3]];
  return ivs.find(([, ms]) => spanMs / ms <= 120) ?? ivs[ivs.length - 1];
}

export function ExecChart({ symbol, marks, from, to, level, className }: {
  symbol: string; marks: ExecMark[]; from: number; to: number; level?: { price: number; label: string } | null; className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const markEls = useRef<(HTMLDivElement | null)[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'empty'>('loading');
  const key = `${symbol}|${from}|${to}|${marks.length}|${level?.price ?? ''}`;
  // Up to 40 markers: an order with hundreds of fills reads better as its first and last few.
  const shown = marks.length > 40 ? [...marks.slice(0, 20), ...marks.slice(-20)] : marks;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let chart: IChartApi | null = null;
    let series: ISeriesApi<'Candlestick'> | null = null;
    let ro: ResizeObserver | null = null;
    let raf = 0;
    let alive = true;
    const span = Math.max(to - from, 20 * 60e3);
    const [iv, ivMs] = pick(span);
    const start = from - span * 0.35, end = Math.min(Date.now(), to + span * 0.35);

    // Glue each marker to its (time, price) on the canvas.
    const place = () => {
      if (!chart || !series) return;
      const ts = chart.timeScale();
      shown.forEach((m, i) => {
        const node = markEls.current[i];
        if (!node) return;
        const x = ts.timeToCoordinate(Math.floor(m.t / 1000 / (ivMs / 1000)) * (ivMs / 1000) as UTCTimestamp);
        const y = series!.priceToCoordinate(m.price);
        if (x == null || y == null) { node.style.opacity = '0'; return; }
        node.style.transform = `translate(${x - 9}px, ${y - 9}px)`;
        node.style.opacity = '1';
      });
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };

    // A busy moment upstream shouldn't leave the chart blank: try a few times.
    const load = async () => {
      for (let i = 0; ; i++) {
        try {
          const r = await analytics.getCandles(symbol, iv, 300, { startTime: Math.floor(start / ivMs) * ivMs, endTime: Math.ceil(end / ivMs) * ivMs });
          if ((r.candles?.length ?? 0) > 0 || i >= 2) return r;
        } catch (e) { if (i >= 2) throw e; }
        await new Promise((ok) => setTimeout(ok, 1200 * (i + 1)));
        if (!alive) throw new Error('gone');
      }
    };
    load()
      .then((r) => {
        if (!alive) return;
        const all = clampWicks(dropFillers((r.candles ?? []).filter((c) => c.o > 0 && c.c > 0))).sort((a, b) => a.t - b.t);
        // A market that stopped trading (a stock perp's pause) leaves a hole, and the restart
        // after it is thin and spiky. Keep only the unbroken stretch the fills happened in.
        const anchor = shown.length ? shown[0].t : (from + to) / 2;
        let lo = 0, hi = all.length - 1;
        const gapAt = (k: number) => all[k + 1].t - all[k].t > ivMs * 4;
        let mid = all.findIndex((c) => c.t + ivMs > anchor); if (mid < 0) mid = all.length - 1;
        for (let k = mid - 1; k >= 0; k--) if (gapAt(k)) { lo = k + 1; break; }
        for (let k = mid; k < all.length - 1; k++) if (gapAt(k)) { hi = k; break; }
        // ...and its edges start and end on minutes that actually traded.
        while (hi > lo && !(Number(all[hi].v) > 0)) hi--;
        while (lo < hi && !(Number(all[lo].v) > 0)) lo++;
        const cs = all.slice(lo, hi + 1);
        if (cs.length < 2) { setState('empty'); return; }
        setState('ok');
        const pos = css('var(--pos)', '#21C07A'), neg = css('var(--neg)', '#E5484D');
        const text = css('var(--role-content-subtle)', '#8a8478'), line = css('var(--border-color)', '#2e2c24');
        chart = createChart(el, {
          width: el.clientWidth, height: el.clientHeight, localization: { locale: 'en-US' },
          layout: { attributionLogo: false, background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 10, fontFamily: getComputedStyle(document.body).fontFamily },
          grid: { vertLines: { visible: false }, horzLines: { color: line.replace(/rgb\(([^)]+)\)/, 'rgba($1,0.3)') } },
          crosshair: { mode: CrosshairMode.Normal, vertLine: { visible: false } },
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
          timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
          handleScroll: false, handleScale: false,
        });
        series = chart.addCandlestickSeries({
          upColor: pos, downColor: neg, borderUpColor: pos, borderDownColor: neg, wickUpColor: pos, wickDownColor: neg,
          priceLineVisible: false, lastValueVisible: false,
          // The order's own level and every fill always stay in view.
          autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
            const base = original();
            const keep = [...shown.map((m) => m.price), level?.price ?? 0].filter((p) => p > 0);
            if (base?.priceRange && keep.length) base.priceRange = { minValue: Math.min(base.priceRange.minValue, ...keep), maxValue: Math.max(base.priceRange.maxValue, ...keep) };
            return base;
          },
        });
        series.setData(cs.map((c) => ({ time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
        if (level && level.price > 0) series.createPriceLine({ price: level.price, color: text, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: level.label });
        chart.timeScale().fitContent();
        chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
        ro = new ResizeObserver(() => { chart?.applyOptions({ width: el.clientWidth, height: el.clientHeight }); schedule(); });
        ro.observe(el);
        schedule();
      })
      .catch(() => { if (alive) setState('empty'); });
    return () => { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); chart?.remove(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={ref} className="absolute inset-0" />
      {state === 'ok' && shown.map((m, i) => (
        <div key={`${m.t}-${i}`} ref={(n) => { markEls.current[i] = n; }} className="absolute left-0 top-0 z-10" style={{ opacity: 0, transition: 'opacity 200ms ease-out' }}>
          <div className="group relative">
            <div className="flex h-[18px] w-[18px] select-none items-center justify-center rounded-full text-[9px] font-medium leading-none text-white"
              style={{ backgroundColor: m.buy ? 'var(--pos)' : 'var(--neg)', border: '2px solid var(--role-surface)' }}>
              {m.buy ? 'B' : 'S'}
            </div>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 group-hover:block">
              <div className="glass-tooltip whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] tabular-nums text-[var(--role-content)]">
                {m.buy ? 'Buy' : 'Sell'}{m.size ? ` ${formatNumber(m.size, 4)}${m.coin ? ` ${m.coin}` : ''}` : ''} · ${formatNumber(m.price, 2)}
              </div>
            </div>
          </div>
        </div>
      ))}
      {state !== 'ok' && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--role-content-subtle)]">
          {state === 'loading' ? 'Loading chart…' : 'No price data for this moment.'}
        </div>
      )}
    </div>
  );
}
