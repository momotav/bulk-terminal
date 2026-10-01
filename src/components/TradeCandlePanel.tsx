'use client';

// ---------------------------------------------------------------------------
// TradeCandlePanel — the price side of the /observe view.
//
// A professional-feel OHLC chart (same lightweight-charts engine as the coin
// modal): timeframe switcher, crosshair OHLC readout, a deep candle history you
// can pan/zoom, the average-entry / liquidation / live-mark price lines, and
// every lifecycle fill marked with HTML B/S circle markers that STACK above the
// candle (de-collided) instead of piling on one spot.
//
// Replay: a ▶ button rewinds to the position's open and reveals the candles
// forward to now inside a fixed frame — the user can zoom/pan the whole time.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, LineStyle,
  type CandlestickData, type UTCTimestamp,
} from 'lightweight-charts';
import { Loader2, Play, Pause } from 'lucide-react';
import { analytics, marketStreamUrl, formatNumber, type Candle } from '@/lib/api';
import { clampWicks } from '@/lib/candles';
import type { TradeEventPoint } from '@/lib/positionWalk';

interface Props {
  symbol: string;               // "BTC-USD"
  side: 'long' | 'short';
  avgEntry: number;
  liqPrice?: number | null;     // live only
  markPrice?: number | null;    // live snapshot; stream overrides
  events: TradeEventPoint[];
  openedAt: number;
  closedAt: number | null;
  isOpen: boolean;
  interval?: string;
  /** Reports the loaded candle set back to the parent so the PnL journey can
   *  be marked against the same prices without a second fetch. */
  onCandles?: (candles: Candle[]) => void;
}

const INTERVALS: [string, string][] = [['5m', '5m'], ['15m', '15m'], ['1h', '1H'], ['4h', '4H'], ['1d', '1D']];
const CANDLE_LIMIT = 500;

const barSeconds = (iv: string): number =>
  iv === '5m' ? 300 : iv === '15m' ? 900 : iv === '1h' ? 3600 : iv === '4h' ? 14400 : iv === '1d' ? 86400 : 3600;

const resolveColor = (expr: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const probe = document.createElement('span');
  probe.style.color = expr;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return resolved || fallback;
};

function pickInterval(openedAt: number, endT: number): string {
  const hrs = (endT - openedAt) / 3_600_000;
  if (hrs < 1) return '5m';
  if (hrs < 6) return '15m';
  if (hrs < 48) return '1h';
  if (hrs < 240) return '4h';
  return '1d';
}

export function TradeCandlePanel({ symbol, side, avgEntry, liqPrice, markPrice, events, openedAt, closedAt, isOpen, interval, onCandles }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const liveBarRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const ohlcRef = useRef<HTMLDivElement | null>(null);
  // B/S marker overlays, glued to (time, price) each frame. markerLayoutRef
  // carries the de-collision layout (snapped bar, bar-high anchor, stack index).
  const markerElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const markerDataRef = useRef<{ key: string; timeSec: number; price: number; buy: boolean; label: string }[]>([]);
  const markerLayoutRef = useRef<Map<string, { sec: number; high: number; stack: number }>>(new Map());
  // Replay plumbing.
  const plottedRef = useRef<Candle[]>([]);
  const replayTimerRef = useRef<number | null>(null);
  const replayCutoffRef = useRef<number>(Infinity); // ms — markers/candles after this are hidden
  const replayingRef = useRef(false);

  const [userInterval, setUserInterval] = useState<string | null>(null);
  const endT = isOpen ? Date.now() : (closedAt ?? openedAt + 3_600_000);
  const iv = userInterval ?? interval ?? pickInterval(openedAt, endT);

  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  replayingRef.current = replaying;

  const markerData = useMemo(
    () => events.map((e, i) => ({
      key: `${i}-${e.t}`,
      timeSec: Math.floor(e.t / 1000),
      price: e.price,
      buy: e.sizeDelta > 0,
      label: e.actionLabel,
    })),
    [events],
  );
  markerDataRef.current = markerData;

  // Deep candle history for the selected interval, ending at the trade's end so
  // the position sits in view with plenty of pannable context on both sides.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReplaying(false);
    const end = (isOpen ? Date.now() : (closedAt ?? openedAt + 3_600_000)) + barSeconds(iv) * 4000;
    analytics
      .getCandles(symbol, iv, CANDLE_LIMIT, { endTime: end })
      .then((res) => { if (!cancelled) { setCandles(res.candles); onCandles?.(res.candles); } })
      .catch(() => { if (!cancelled) setError('Could not load price chart'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, iv, openedAt, closedAt, isOpen]);

  const plotted = useMemo(
    () => clampWicks((candles ?? []).filter((c) =>
      Number.isFinite(c.o) && c.o > 0 && Number.isFinite(c.h) && c.h > 0 &&
      Number.isFinite(c.l) && c.l > 0 && Number.isFinite(c.c) && c.c > 0)),
    [candles],
  );
  plottedRef.current = plotted;

  const toLW = (c: Candle): CandlestickData => ({ time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c });

  // ---- main chart build -----------------------------------------------------
  useEffect(() => {
    if (!candles || !containerRef.current) return;
    const container = containerRef.current;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; seriesRef.current = null; }

    const isLight = typeof document !== 'undefined' &&
      !document.documentElement.classList.contains('dark') &&
      document.documentElement.getAttribute('data-theme') !== 'dark';
    const grid = isLight ? 'rgba(115,106,108,0.10)' : 'rgba(84,74,76,0.12)';
    const border = isLight ? 'rgba(115,106,108,0.35)' : 'rgba(84,74,76,0.35)';
    const text = isLight ? '#736A6C' : '#807678';
    const pos = resolveColor('var(--pos)', '#21C07A');
    const neg = resolveColor('var(--neg)', '#E5484D');
    const accent = resolveColor('var(--accent)', '#FFB457');

    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: container.clientHeight || 360,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: pos, downColor: neg, borderUpColor: pos, borderDownColor: neg, wickUpColor: pos, wickDownColor: neg,
    });
    seriesRef.current = series;
    series.setData(plotted.map(toLW));
    if (plotted.length > 0) {
      const lc = plotted[plotted.length - 1];
      liveBarRef.current = { time: Math.floor(lc.t / 1000), open: lc.o, high: lc.h, low: lc.l, close: lc.c };
    }

    // Price lines.
    series.createPriceLine({ price: avgEntry, color: side === 'long' ? pos : neg, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Entry' });
    let markLine: ReturnType<typeof series.createPriceLine> | null = null;
    if (isOpen && markPrice && markPrice > 0) {
      markLine = series.createPriceLine({ price: markPrice, color: accent, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Mark' });
    }
    if (isOpen && liqPrice && liqPrice > 0) {
      series.createPriceLine({ price: liqPrice, color: neg, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Liq.' });
    }

    // Marker de-collision layout: snap each fill onto the nearest bar, anchor it
    // above that bar's HIGH, and stack multiple fills on the same bar upward.
    const secs = plotted.map((c) => Math.floor(c.t / 1000));
    const highBySec = new Map(plotted.map((c) => [Math.floor(c.t / 1000), c.h]));
    const snap = (sec: number): number => {
      if (!secs.length) return sec;
      let best = secs[0]; let bd = Math.abs(best - sec);
      for (const s of secs) { const d = Math.abs(s - sec); if (d < bd) { bd = d; best = s; } }
      return best;
    };
    const perBar = new Map<number, number>();
    const layout = new Map<string, { sec: number; high: number; stack: number }>();
    for (const m of markerData) {
      const s = snap(m.timeSec);
      const stack = perBar.get(s) ?? 0;
      perBar.set(s, stack + 1);
      layout.set(m.key, { sec: s, high: highBySec.get(s) ?? m.price, stack });
    }
    markerLayoutRef.current = layout;

    // Crosshair OHLC readout.
    chart.subscribeCrosshairMove((param) => {
      const el = ohlcRef.current; if (!el) return;
      const d = param.seriesData.get(series) as CandlestickData | undefined;
      if (!d || param.time == null) { el.textContent = ''; return; }
      const dp = d.close < 10 ? 4 : 2;
      el.textContent = `O ${d.open.toFixed(dp)}  H ${d.high.toFixed(dp)}  L ${d.low.toFixed(dp)}  C ${d.close.toFixed(dp)}`;
      el.style.color = d.close >= d.open ? pos : neg;
    });

    // Focus the initial view on the trade (≥45 bars), everything else pannable.
    const bsec = barSeconds(iv);
    try {
      const endSec = Math.floor(endT / 1000) + bsec * 4;
      const fromSec = Math.min(Math.floor(openedAt / 1000) - bsec * 8, endSec - bsec * 45);
      chart.timeScale().setVisibleRange({ from: fromSec as UTCTimestamp, to: endSec as UTCTimestamp });
    } catch { chart.timeScale().fitContent(); }

    const resize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth; const h = containerRef.current.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    };
    const raf = requestAnimationFrame(resize);
    const obs = new ResizeObserver(resize);
    obs.observe(container);

    // Marker positioning loop — stacked above the bar high, hidden past the
    // replay cutoff.
    const positionMarkers = () => {
      const c = chartRef.current, s = seriesRef.current, cont = containerRef.current;
      if (!c || !s || !cont) return;
      const ts = c.timeScale();
      const w = cont.clientWidth, h = cont.clientHeight;
      for (const m of markerDataRef.current) {
        const node = markerElsRef.current.get(m.key);
        if (!node) continue;
        const L = markerLayoutRef.current.get(m.key);
        if (!L || m.timeSec * 1000 > replayCutoffRef.current + 1) { node.style.opacity = '0'; continue; }
        const x = ts.timeToCoordinate(L.sec as UTCTimestamp);
        const yHigh = s.priceToCoordinate(L.high);
        if (x == null || yHigh == null) { node.style.opacity = '0'; continue; }
        const y = (yHigh as number) - 14 - L.stack * 19;
        const vis = (x as number) >= 0 && (w === 0 || (x as number) <= w) && y >= -10 && (h === 0 || y <= h + 10);
        if (vis) {
          node.style.transform = `translate(${Math.round(x as number)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
          node.style.opacity = '1';
        } else {
          node.style.opacity = '0';
        }
      }
    };
    let markerRaf = requestAnimationFrame(function loop() { positionMarkers(); markerRaf = requestAnimationFrame(loop); });

    // Live candle extension (gated off during replay).
    let es: EventSource | null = null;
    if (isOpen) {
      const bucket = barSeconds(iv);
      es = new EventSource(marketStreamUrl(symbol));
      es.onmessage = (ev) => {
        if (replayingRef.current) return;
        let msg: { price: number; kind: string; ts: number };
        try { msg = JSON.parse(ev.data); } catch { return; }
        const price = Number(msg.price);
        if (!(price > 0)) return;
        const s = seriesRef.current; if (!s) return;
        const tSec = Math.floor((msg.ts || Date.now()) / 1000);
        const bStart = Math.floor(tSec / bucket) * bucket;
        const bar = liveBarRef.current;
        if (!bar || bStart > bar.time) {
          const nb = { time: bStart, open: price, high: price, low: price, close: price };
          liveBarRef.current = nb;
          s.update({ time: nb.time as UTCTimestamp, open: nb.open, high: nb.high, low: nb.low, close: nb.close });
        } else if (bStart === bar.time) {
          bar.close = price; if (price > bar.high) bar.high = price; if (price < bar.low) bar.low = price;
          s.update({ time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
        }
        if (msg.kind === 'mark' && markLine) markLine.applyOptions({ price });
      };
      es.onerror = () => { /* EventSource auto-reconnects */ };
    }

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(markerRaf);
      obs.disconnect();
      if (es) es.close();
      liveBarRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [plotted, candles, events, avgEntry, liqPrice, markPrice, side, isOpen, symbol, iv]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- replay ---------------------------------------------------------------
  useEffect(() => {
    const s = seriesRef.current;
    const data = plottedRef.current;
    if (!s || data.length < 2) return;

    if (!replaying) {
      replayCutoffRef.current = Infinity;
      s.setData(data.map(toLW)); // restore the full series
      return;
    }

    const bsec = barSeconds(iv);
    let idx = data.findIndex((c) => c.t >= openedAt);
    if (idx < 1) idx = Math.max(1, Math.floor(data.length * 0.3));
    // Fix the frame to the whole open→now span so revealed candles draw into it.
    const chart = chartRef.current;
    if (chart) {
      try {
        chart.timeScale().setVisibleRange({
          from: (Math.floor(openedAt / 1000) - bsec * 30) as UTCTimestamp,
          to: (Math.floor(endT / 1000) + bsec * 5) as UTCTimestamp,
        });
      } catch { /* out of range — leave the view as-is */ }
    }
    s.setData(data.slice(0, idx + 1).map(toLW));
    replayCutoffRef.current = data[idx].t;

    replayTimerRef.current = window.setInterval(() => {
      idx += 1;
      if (idx >= data.length) {
        if (replayTimerRef.current) { window.clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
        replayCutoffRef.current = Infinity;
        setReplaying(false);
        return;
      }
      seriesRef.current?.update(toLW(data[idx]));
      replayCutoffRef.current = data[idx].t;
    }, 110);

    return () => {
      if (replayTimerRef.current) { window.clearInterval(replayTimerRef.current); replayTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaying, openedAt, iv]);

  const canReplay = plotted.length >= 3;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-1 pb-1.5 font-mono">
        <div className="flex items-center gap-0.5">
          {INTERVALS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setReplaying(false); setUserInterval(id); }}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors ${
                iv === id ? 'bg-[var(--bg-secondary-20)] text-[var(--role-content)]' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div ref={ohlcRef} className="ml-2 min-w-0 truncate text-[10px] tabular-nums text-[var(--role-content-subtle)]" />
        <button
          onClick={() => canReplay && setReplaying((r) => !r)}
          disabled={!canReplay}
          title={replaying ? 'Pause replay' : 'Replay from open'}
          className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--role-line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--role-content)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-text)] disabled:opacity-40"
        >
          {replaying ? <><Pause className="h-3 w-3" /> Pause</> : <><Play className="h-3 w-3" /> Replay</>}
        </button>
      </div>

      {/* Chart + markers */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />

        {markerData.map((m) => (
          <div
            key={m.key}
            ref={(el) => { if (el) markerElsRef.current.set(m.key, el); else markerElsRef.current.delete(m.key); }}
            className="absolute left-0 top-0 z-20"
            style={{ opacity: 0, pointerEvents: 'none', willChange: 'transform, opacity' }}
          >
            <div className="group relative flex items-center justify-center" style={{ pointerEvents: 'auto' }}>
              <div
                className="flex h-[18px] w-[18px] cursor-default select-none items-center justify-center rounded-full text-[9px] font-bold leading-none text-white shadow"
                style={{ backgroundColor: m.buy ? 'var(--pos)' : 'var(--neg)', border: '2px solid var(--role-surface)' }}
              >
                {m.buy ? 'B' : 'S'}
              </div>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 group-hover:block">
                <div className="relative whitespace-nowrap rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-medium tabular-nums text-gray-900 shadow-xl">
                  {m.label} · ${formatNumber(m.price, 2)}
                  <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 bg-white" />
                </div>
              </div>
            </div>
          </div>
        ))}

        {(loading || error) && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-[var(--role-content-subtle)]">
            {loading && !error && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading price…</>}
            {error && <span className="text-[var(--neg)]">{error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
