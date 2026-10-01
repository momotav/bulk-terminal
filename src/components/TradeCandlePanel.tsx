'use client';

// ---------------------------------------------------------------------------
// TradeCandlePanel — the price side of the /observe view.
//
// OHLC candles over the trade's life, with the average entry (side-coloured),
// liquidation (live only) and live mark drawn as price lines, and every
// lifecycle fill marked with the same HTML-overlay B/S circle markers the
// position chart modal uses (filled circle + white glyph + hover tooltip),
// positioned each frame from their (time, price) via a rAF loop.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart, ColorType, IChartApi, ISeriesApi, LineStyle,
  type CandlestickData, type UTCTimestamp,
} from 'lightweight-charts';
import { Loader2 } from 'lucide-react';
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
  // B/S circle marker overlays (same pattern as PositionChartModal): DOM nodes
  // glued to their (time, price) each frame by a rAF loop. markerEls maps key→
  // node; markerDataRef mirrors the memo so the loop reads current markers;
  // candleSecsRef lets it snap a fill time onto the nearest loaded bar.
  const markerElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const markerDataRef = useRef<{ key: string; timeSec: number; price: number; buy: boolean; label: string }[]>([]);
  const candleSecsRef = useRef<number[]>([]);

  const endT = isOpen ? Date.now() : (closedAt ?? openedAt + 3_600_000);
  const iv = interval ?? pickInterval(openedAt, endT);

  // One marker per fill; buy = green "B" (reduces a short / adds a long),
  // sell = red "S". Deduped by snapped-bar happens visually via z-stacking —
  // adjacent same-bar circles overlap slightly, which reads fine.
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

  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pad the window so there's price context before entry and after exit.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const dur = Math.max(endT - openedAt, 30 * 60_000);
    const pad = Math.max(dur * 0.25, 30 * 60_000);
    analytics
      .getCandles(symbol, iv, 300, { startTime: openedAt - pad, endTime: endT + pad })
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

  useEffect(() => {
    if (!candles || !containerRef.current) return;
    const container = containerRef.current;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; seriesRef.current = null; }

    const isLight = typeof document !== 'undefined' &&
      !document.documentElement.classList.contains('dark') &&
      document.documentElement.getAttribute('data-theme') !== 'dark';
    const grid = isLight ? 'rgba(115,106,108,0.12)' : 'rgba(84,74,76,0.14)';
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
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: pos, downColor: neg, borderUpColor: pos, borderDownColor: neg, wickUpColor: pos, wickDownColor: neg,
    });
    seriesRef.current = series;

    const data: CandlestickData[] = plotted.map((c) => ({
      time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    series.setData(data);
    if (plotted.length > 0) {
      const lc = plotted[plotted.length - 1];
      liveBarRef.current = { time: Math.floor(lc.t / 1000), open: lc.o, high: lc.h, low: lc.l, close: lc.c };
    }

    // Price lines: average entry (side-coloured), liq (live), mark (live).
    series.createPriceLine({ price: avgEntry, color: side === 'long' ? pos : neg, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Entry' });
    let markLine: ReturnType<typeof series.createPriceLine> | null = null;
    if (isOpen && markPrice && markPrice > 0) {
      markLine = series.createPriceLine({ price: markPrice, color: accent, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Mark' });
    }
    if (isOpen && liqPrice && liqPrice > 0) {
      series.createPriceLine({ price: liqPrice, color: neg, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Liq.' });
    }

    // Bar times for snapping markers onto a real bar (timeToCoordinate returns
    // null off-grid), used by the positioning loop below.
    candleSecsRef.current = plotted.map((c) => Math.floor(c.t / 1000));

    chart.timeScale().fitContent();

    const resize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth; const h = containerRef.current.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    };
    const raf = requestAnimationFrame(resize);
    const obs = new ResizeObserver(resize);
    obs.observe(container);

    // Glue each B/S marker to its (time, price) every frame — tracks pan / zoom
    // / resize / live price-scale moves with no React re-render (compositor-only
    // transform + opacity), exactly like the modal's markers.
    const snap = (sec: number): number => {
      const secs = candleSecsRef.current;
      if (!secs.length) return sec;
      let best = secs[0]; let bd = Math.abs(best - sec);
      for (const s of secs) { const d = Math.abs(s - sec); if (d < bd) { bd = d; best = s; } }
      return best;
    };
    const positionMarkers = () => {
      const c = chartRef.current, s = seriesRef.current, cont = containerRef.current;
      if (!c || !s || !cont) return;
      const ts = c.timeScale();
      const w = cont.clientWidth, h = cont.clientHeight;
      for (const m of markerDataRef.current) {
        const node = markerElsRef.current.get(m.key);
        if (!node) continue;
        const x = ts.timeToCoordinate(snap(m.timeSec) as UTCTimestamp);
        const y = s.priceToCoordinate(m.price);
        const vis = x != null && y != null && (x as number) >= 0 && (w === 0 || (x as number) <= w) && (y as number) >= 0 && (h === 0 || (y as number) <= h);
        if (vis) {
          node.style.transform = `translate(${Math.round(x as number)}px, ${Math.round(y as number)}px) translate(-50%, -50%)`;
          node.style.opacity = '1';
        } else {
          node.style.opacity = '0';
        }
      }
    };
    let markerRaf = requestAnimationFrame(function loop() {
      positionMarkers();
      markerRaf = requestAnimationFrame(loop);
    });

    // Live candle extension while the trade is open.
    let es: EventSource | null = null;
    if (isOpen) {
      const bucket = iv === '5m' ? 300 : iv === '15m' ? 900 : iv === '1h' ? 3600 : iv === '4h' ? 14400 : iv === '1d' ? 86400 : 3600;
      es = new EventSource(marketStreamUrl(symbol));
      es.onmessage = (ev) => {
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
  }, [plotted, candles, events, avgEntry, liqPrice, markPrice, side, isOpen, symbol, iv]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* B/S circle markers — filled circle + white glyph + hover tooltip.
          Always mounted; positioned/shown by the rAF loop (markerElsRef). */}
      {markerData.map((m) => (
        <div
          key={m.key}
          ref={(el) => { if (el) markerElsRef.current.set(m.key, el); else markerElsRef.current.delete(m.key); }}
          className="absolute left-0 top-0 z-20"
          style={{ opacity: 0, pointerEvents: 'none', willChange: 'transform, opacity' }}
        >
          <div className="group relative flex items-center justify-center" style={{ pointerEvents: 'auto' }}>
            <div
              className="flex h-[20px] w-[20px] cursor-default select-none items-center justify-center rounded-full text-[10px] font-bold leading-none text-white shadow"
              style={{ backgroundColor: m.buy ? 'var(--pos)' : 'var(--neg)', border: '2px solid var(--role-surface)' }}
            >
              {m.buy ? 'B' : 'S'}
            </div>
            {/* Tooltip above the marker. */}
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
  );
}
