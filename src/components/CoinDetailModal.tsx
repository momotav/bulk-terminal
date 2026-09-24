'use client';

// ----------------------------------------------------------------------------
// CoinDetailModal — a full trading-terminal popover for one market. Opens from
// the Markets table: a candlestick chart (lightweight-charts) with timeframe
// toggles on the left, a live order book on the right, and a header of the key
// market stats (mark price, 24h change, 24h volume, open interest).
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createChart, ColorType, type IChartApi, type ISeriesApi,
  type CandlestickData, type UTCTimestamp, type WhitespaceData, type IPriceLine,
  type SeriesMarker,
} from 'lightweight-charts';
import { X } from 'lucide-react';
import { analytics, cn, formatCompact, formatAddress, marketStreamUrl, type Candle, type OrderbookSnapshot, type MarketTrade, type MarketLiquidation } from '@/lib/api';
import { type BulkTicker, openInterestUsd } from '@/hooks/useTickers';
import { clampWicks } from '@/lib/candles';
import { CoinIcon } from '@/components/CoinIcon';
import { MarginSurface } from '@/components/MarginSurface';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';

const INTERVALS: { label: string; value: string }[] = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1D', value: '1d' },
];

const coinOf = (symbol: string) => symbol.replace(/-USD$/, '');
const usd = (n: number) => `$${formatCompact(n)}`;

// A trade or liquidation the user clicked, pinned onto the chart.
interface FocusEvent {
  kind: 'trade' | 'liq';
  price: number;
  ts: number; // ms
  side: string;
  size: number;
  value: number;
}

export function CoinDetailModal({ ticker, onClose }: { ticker: BulkTicker | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  const [interval, setIntervalValue] = useState('1h');
  const [chartView, setChartView] = useState<'chart' | 'depth' | 'margin'>('chart');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [book, setBook] = useState<OrderbookSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  // Live mark price from the SSE stream — drives the header + order-book mid so
  // the numbers tick in real time (not only on the parent's slow ticker poll).
  const [livePrice, setLivePrice] = useState<number | null>(null);
  // A row (trade/liquidation) the user clicked to pin onto the chart.
  const [focusEvent, setFocusEvent] = useState<FocusEvent | null>(null);
  // Recent liquidations, drawn on the chart as markers so you can see where
  // liquidations happened relative to price.
  const [chartLiqs, setChartLiqs] = useState<MarketLiquidation[]>([]);
  const focusEventRef = useRef<FocusEvent | null>(null);
  // Live pixel position of the pinned marker (DOM overlay, so we can place it
  // exactly on the price and float it above the candle, unlike native markers).
  const [markerPos, setMarkerPos] = useState<{ x: number; y: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  // Only treat a click as "backdrop click to close" when BOTH the press and the
  // release land on the backdrop itself — so a drag that starts inside the
  // panel (e.g. panning the chart) and ends outside never closes the modal.
  const backdropDown = useRef(false);
  // Last (in-progress) bar, extended live from the market SSE stream.
  const liveBarRef = useRef<{ time: number; o: number; h: number; l: number; c: number } | null>(null);
  // Current interval's bucket length in seconds (read inside the SSE handler).
  const bucketSecRef = useRef(3600);
  // Price line + marker for a pinned trade/liquidation, so we can clear it.
  const focusLineRef = useRef<IPriceLine | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const symbol = ticker?.symbol ?? null;

  // Esc to close + lock the page scroll while open.
  useEffect(() => {
    if (!symbol) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [symbol, onClose]);

  // Reset the live price when the market changes.
  useEffect(() => { setLivePrice(null); }, [symbol]);

  // Market SSE stream — kept open the whole time the modal is open (not just on
  // the Chart tab), so the header/mid tick live in every view. Drives livePrice.
  useEffect(() => {
    if (!symbol) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(marketStreamUrl(symbol));
      es.onmessage = (ev) => {
        let msg: { price: number; ts: number };
        try { msg = JSON.parse(ev.data); } catch { return; }
        const price = Number(msg.price);
        if (!(price > 0)) return;
        setLivePrice(price);
        // Extend the in-progress candle (Chart view only, chart mounted).
        const s = seriesRef.current;
        const bs = bucketSecRef.current;
        if (!s || !bs) return;
        const tSec = Math.floor((msg.ts || Date.now()) / 1000);
        const bucketStart = Math.floor(tSec / bs) * bs;
        const bar = liveBarRef.current;
        try {
          if (!bar || bucketStart > bar.time) {
            const nb = { time: bucketStart, o: price, h: price, l: price, c: price };
            liveBarRef.current = nb;
            s.update({ time: nb.time as UTCTimestamp, open: nb.o, high: nb.h, low: nb.l, close: nb.c });
          } else if (bucketStart === bar.time) {
            bar.c = price;
            if (price > bar.h) bar.h = price;
            if (price < bar.l) bar.l = price;
            s.update({ time: bar.time as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c });
          }
        } catch { /* stale/out-of-order print — ignore, never break the stream */ }
      };
      es.onerror = () => { /* EventSource auto-reconnects */ };
    } catch { /* stream unavailable */ }
    return () => { es?.close(); };
  }, [symbol]);

  // Load candles ONCE per (symbol, interval, view). We deliberately don't poll:
  // the SSE stream below drives all live movement, and re-running setData on a
  // timer would reset the user's zoom/pan (fitContent). A backstop refetch every
  // 60s keeps the history fresh without disturbing the view mid-interaction.
  useEffect(() => {
    if (!symbol || chartView !== 'chart') return;
    let cancelled = false;
    // Reset so we show a loading state (not the previous coin's candles or a
    // stale "No candle data") while the new coin loads.
    setCandles(null);
    setLoading(true);
    // BULK's candle endpoint occasionally returns empty or errors on a coin
    // swap (rate-limit / paged-envelope timing) — which flashed "No candle
    // data" until a manual refresh. Retry a couple times before accepting empty.
    const load = (attempt: number) => {
      analytics.getCandles(symbol, interval, 300)
        .then((res) => {
          if (cancelled) return;
          const c = res.candles || [];
          if (c.length === 0 && attempt < 2) {
            setTimeout(() => { if (!cancelled) load(attempt + 1); }, 700);
            return;
          }
          setCandles(c);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 2) setTimeout(() => { if (!cancelled) load(attempt + 1); }, 700);
          else { setCandles([]); setLoading(false); }
        });
    };
    load(0);
    return () => { cancelled = true; };
  }, [symbol, interval, chartView]);

  // Order book — poll every 3s while open.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const coin = coinOf(symbol);
    const load = () => analytics.getOrderbook(coin, 20).then((b) => { if (!cancelled) setBook(b); }).catch(() => {});
    load();
    const id = window.setInterval(load, 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [symbol]);

  // Recent liquidations for the chart markers — poll every 15s.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const coin = coinOf(symbol);
    const load = () => analytics.getMarketLiquidations(coin, 40).then((l) => { if (!cancelled) setChartLiqs(l); }).catch(() => {});
    load();
    const id = window.setInterval(load, 15000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [symbol]);

  // Drop BULK's empty no-trade filler candles + clamp bad-print wicks.
  const plotted = useMemo(
    () => clampWicks((candles ?? []).filter((c) => c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0)),
    [candles],
  );

  // Create the chart when the Chart view is active. Data is pushed below.
  useEffect(() => {
    const container = wrapRef.current;
    if (!symbol || chartView !== 'chart' || !container) return;
    // lightweight-charts renders to canvas and can't parse CSS variables OR the
    // modern space-separated `rgb(128 118 120)` syntax our tokens use. Resolve
    // each to a canonical comma-form rgb() via a throwaway element.
    const v = (expr: string, fb: string): string => {
      const probe = document.createElement('span');
      probe.style.color = expr;
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      document.body.removeChild(probe);
      return resolved || fb;
    };
    const pos = v('var(--pos)', 'rgb(33, 192, 122)');
    const neg = v('var(--neg)', 'rgb(229, 72, 77)');
    const grid = v('var(--role-line-subtle)', 'rgba(128, 118, 120, 0.12)');
    const border = v('var(--role-line)', 'rgba(128, 118, 120, 0.24)');
    const text = v('var(--role-content-subtle)', 'rgb(138, 138, 138)');
    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: container.clientHeight || 420,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontSize: 11 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
      // On phones, DON'T let a touch drag pan the chart — let it scroll the
      // modal vertically instead. Pinch-zoom stays on so the chart is still
      // explorable. On desktop, full mouse pan/zoom as usual.
      handleScroll: isMobile
        ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: false, vertTouchDrag: false }
        : true,
      handleScale: isMobile
        ? { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true }
        : true,
    });
    chartRef.current = chart;
    // Price-axis precision scaled to the coin's price, so sub-cent coins (PUMP,
    // FARTCOIN) don't render every axis label + the last-price tag as "0.00".
    const px0 = ticker?.markPrice || ticker?.lastPrice || 1;
    const prec = priceDecimals(px0);
    seriesRef.current = chart.addCandlestickSeries({
      upColor: pos, downColor: neg,
      borderUpColor: pos, borderDownColor: neg,
      wickUpColor: pos, wickDownColor: neg,
      priceFormat: { type: 'price', precision: prec, minMove: Math.pow(10, -prec) },
    });
    const resize = () => chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    const obs = new ResizeObserver(resize);
    obs.observe(container);
    return () => { obs.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [symbol, chartView, isMobile]);

  // Push candle data whenever it changes (or when returning to the Chart view).
  useEffect(() => {
    if (chartView !== 'chart') return;
    const series = seriesRef.current;
    if (!series) return;
    const data: (CandlestickData | WhitespaceData)[] = plotted.map((c) => ({
      time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    series.setData(data);
    // Seed the in-progress bar so live ticks extend it instead of snapping.
    const lc = plotted[plotted.length - 1];
    liveBarRef.current = lc ? { time: Math.floor(lc.t / 1000), o: lc.o, h: lc.h, l: lc.l, c: lc.c } : null;
    chartRef.current?.timeScale().fitContent();
  }, [plotted, chartView]);

  // Draw recent liquidations as chart markers (colored circles at their bar), so
  // you can see WHERE liquidations happened relative to price. Only markers
  // whose time falls within the loaded candle range are shown.
  useEffect(() => {
    if (chartView !== 'chart') return;
    const series = seriesRef.current;
    if (!series || plotted.length === 0) return;
    const resolve = (expr: string) => {
      const probe = document.createElement('span'); probe.style.color = expr; probe.style.display = 'none';
      document.body.appendChild(probe); const c = getComputedStyle(probe).color; document.body.removeChild(probe); return c || '#888';
    };
    const posC = resolve('var(--pos)'); const negC = resolve('var(--neg)');
    const firstT = Math.floor(plotted[0].t / 1000);
    const bs = bucketSecRef.current;
    const seen = new Set<number>();
    const markers: SeriesMarker<UTCTimestamp>[] = chartLiqs
      .map((l) => {
        const bucket = Math.floor(Math.floor(l.timestamp / 1000) / bs) * bs;
        const long = /long|buy/i.test(l.side);
        return { bucket, long };
      })
      .filter((m) => m.bucket >= firstT)
      .filter((m) => { if (seen.has(m.bucket)) return false; seen.add(m.bucket); return true; })
      .sort((a, b) => a.bucket - b.bucket)
      .map((m) => ({
        time: m.bucket as UTCTimestamp,
        position: 'aboveBar' as const,
        color: m.long ? posC : negC,
        shape: 'circle' as const,
        text: 'Liq',
      }));
    try { series.setMarkers(markers); } catch { /* out-of-range — ignore */ }
  }, [chartLiqs, plotted, chartView]);

  // Keep the SSE handler's bucket length in sync with the selected interval.
  useEffect(() => {
    bucketSecRef.current =
      interval === '1m' ? 60 :
      interval === '5m' ? 300 :
      interval === '15m' ? 900 :
      interval === '1h' ? 3600 :
      interval === '4h' ? 14400 :
      interval === '1d' ? 86400 : 3600;
  }, [interval]);

  // Draw the pinned trade/liquidation's dashed price line. The circular B/S/L
  // badge itself is a DOM overlay (positioned by the effect below) so it can
  // float above the candle exactly on the price — native markers can't.
  useEffect(() => {
    focusEventRef.current = focusEvent;
    const series = seriesRef.current;
    if (!series || chartView !== 'chart') return;
    if (focusLineRef.current) { try { series.removePriceLine(focusLineRef.current); } catch { /* gone */ } focusLineRef.current = null; }
    if (!focusEvent) { return; }

    const isBuy = /buy|long/i.test(focusEvent.side);
    const color = focusEvent.kind === 'liq' ? 'var(--neg)' : (isBuy ? 'var(--pos)' : 'var(--neg)');
    const resolved = (() => {
      const probe = document.createElement('span');
      probe.style.color = color; probe.style.display = 'none';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color; document.body.removeChild(probe);
      return c || '#888';
    })();
    try {
      focusLineRef.current = series.createPriceLine({
        price: focusEvent.price,
        color: resolved,
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: focusEvent.kind === 'liq' ? 'LIQ' : (isBuy ? 'BUY' : 'SELL'),
      });
    } catch { /* out-of-range price — ignore */ }
  }, [focusEvent, chartView, plotted]);

  // Keep the DOM badge glued to (time, price): recompute its pixel coords each
  // frame while pinned, so it tracks zoom/pan/live candles. One element, so the
  // rAF loop is cheap; we only re-render when it moves > ~0.5px.
  useEffect(() => {
    if (!focusEvent || chartView !== 'chart') { setMarkerPos(null); return; }
    let raf = 0;
    const last = { x: -1, y: -1 };
    const tick = () => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (chart && series) {
        const bs = bucketSecRef.current;
        const bucketStart = Math.floor(Math.floor(focusEvent.ts / 1000) / bs) * bs;
        const x = chart.timeScale().timeToCoordinate(bucketStart as UTCTimestamp);
        const y = series.priceToCoordinate(focusEvent.price);
        if (x != null && y != null) {
          if (Math.abs(x - last.x) > 0.5 || Math.abs(y - last.y) > 0.5) {
            last.x = x; last.y = y;
            setMarkerPos({ x, y });
          }
        } else {
          setMarkerPos(null); // scrolled out of view
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [focusEvent, chartView]);

  // Pin a row and jump to the chart.
  const focusRow = (e: FocusEvent) => {
    setChartView('chart');
    setFocusEvent(e);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (typeof document === 'undefined' || !symbol || !ticker) return null;

  const up = ticker.priceChangePercent >= 0;
  const changeColor = up ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';
  // Prefer the live SSE price for the header + order-book mid.
  const displayPrice = livePrice ?? ticker.markPrice ?? ticker.lastPrice;

  return createPortal(
    <div
      className="animate-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-3 backdrop-blur-md sm:p-6"
      onMouseDown={(e) => { backdropDown.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => { if (backdropDown.current && e.target === e.currentTarget) onClose(); backdropDown.current = false; }}
    >
      <div className="animate-modal-panel flex h-full max-h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--role-line)] bg-[var(--role-surface)] shadow-2xl">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar">
          <div className="flex flex-col lg:flex-row lg:items-stretch">
            {/* ---- Left: header stats + candlestick chart ---- */}
            <div className="flex min-h-0 flex-1 flex-col border-b border-[var(--role-line-subtle)] lg:border-b-0 lg:border-r">
          {/* Header stats. The close button is pinned to the top-right corner
              (absolute) so it stays put no matter how the stats wrap. */}
          <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--role-line-subtle)] px-4 py-3 pr-12 sm:px-5 sm:pr-12">
            <div className="flex items-center gap-2.5">
              <CoinIcon symbol={symbol} size={28} />
              <span className="font-sans text-xl font-bold tracking-tight text-[var(--role-content)]">{symbol}</span>
            </div>
            <Stat label="Mark Price" value={usd(displayPrice)} />
            <Stat label="24H Change" value={`${up ? '+' : ''}${ticker.priceChangePercent.toFixed(2)}%`} color={changeColor} />
            <Stat label="24H Volume" value={usd(ticker.quoteVolume)} />
            <Stat label="Open Interest" value={usd(openInterestUsd(ticker))} />
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-[var(--role-content-subtle)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--role-content)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Interval toggles (chart view only) + Chart/Depth/Margin switcher.
              The interval strip scrolls within its own space (min-w-0 + scroll)
              so it can never push the view switcher off the right edge. */}
          <div className="flex items-center justify-between gap-2 px-4 py-2 sm:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-hide">
              {chartView === 'chart' && INTERVALS.map((it) => (
                <button
                  key={it.value}
                  onClick={() => setIntervalValue(it.value)}
                  className={cn(
                    'shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                    interval === it.value
                      ? 'bg-[var(--bg-secondary-20)] text-[var(--role-content)]'
                      : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
                  )}
                >
                  {it.label}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-sm font-semibold">
              {(['chart', 'depth', 'margin'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setChartView(v)}
                  className={cn('capitalize transition-colors', chartView === v ? 'text-[var(--role-content)]' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* One view at a time — grows to match the order-book column height. */}
          <div className="relative min-h-[360px] flex-1 px-2 pb-2 lg:min-h-0">
            {chartView === 'chart' && (
              <>
                <div ref={wrapRef} className="h-full w-full" style={{ touchAction: 'pan-y' }} />
                {focusEvent && markerPos && (() => {
                  const isBuy = /buy|long/i.test(focusEvent.side) && focusEvent.kind !== 'liq';
                  const color = isBuy ? 'var(--pos)' : 'var(--neg)';
                  const letter = focusEvent.kind === 'liq' ? 'L' : (isBuy ? 'B' : 'S');
                  const verb = focusEvent.kind === 'liq' ? 'Liquidation' : (isBuy ? 'Buy' : 'Sell');
                  return (
                    <div
                      className="group absolute z-20"
                      // Float the badge above the price point (translate up so its
                      // bottom sits ~18px over the exact price coordinate).
                      style={{ left: markerPos.x, top: markerPos.y, transform: 'translate(-50%, -180%)' }}
                    >
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold text-white shadow-md"
                        style={{ background: color, borderColor: 'var(--role-surface)' }}
                      >
                        {letter}
                      </div>
                      {/* Hover tooltip */}
                      <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--role-line)] bg-[var(--role-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--role-content)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        {verb} at ${fmtPx(focusEvent.price)}
                      </div>
                    </div>
                  );
                })()}
                {focusEvent && (
                  <button
                    onClick={() => setFocusEvent(null)}
                    className="absolute left-3 top-2 z-10 flex items-center gap-1.5 rounded-md border border-[var(--role-line)] bg-[var(--role-surface)]/90 px-2 py-1 text-[11px] font-medium text-[var(--role-content)] backdrop-blur-sm"
                  >
                    <span style={{ color: /buy|long/i.test(focusEvent.side) && focusEvent.kind !== 'liq' ? 'var(--pos)' : 'var(--neg)' }}>
                      {focusEvent.kind === 'liq' ? 'LIQ' : (/buy|long/i.test(focusEvent.side) ? 'BUY' : 'SELL')}
                    </span>
                    ${fmtPx(focusEvent.price)} · {focusEvent.size.toFixed(4)} · ${fmtUsdShort(focusEvent.value)}
                    <X className="h-3 w-3" />
                  </button>
                )}
                {loading && plotted.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--role-content-subtle)]">Loading chart…</div>
                )}
                {!loading && plotted.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--role-content-subtle)]">No candle data.</div>
                )}
              </>
            )}
            {/* Explicit mobile height — recharts/embedded layouts need a real
                pixel height (a parent min-height alone measures 0, so the Depth
                chart came up blank on phones). Desktop stretches via h-full. */}
            {chartView === 'depth' && <div className="h-[360px] w-full lg:h-full"><DepthChart book={book} /></div>}
            {chartView === 'margin' && (
              <div className="h-[440px] w-full overflow-hidden lg:h-full">
                <MarginSurface coin={coinOf(symbol)} embedded />
              </div>
            )}
          </div>
        </div>

            {/* ---- Right: order book + Trade button ---- */}
            <div className="flex w-full flex-col border-b border-[var(--role-line-subtle)] lg:w-[380px] lg:border-b-0 xl:w-[440px]">
              <OrderBook book={book} mark={displayPrice} last={displayPrice} up={up} />
              {/* Trade CTA under the book. The chart column stretches to this
                  column's height, so chart height = order book + this button. */}
              <div className="p-3">
                <a
                  href={`https://app.bulk.trade/trade/${symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="trade-cta flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-base font-bold tracking-wide transition-[filter] hover:brightness-105"
                >
                  Trade {coinOf(symbol)}
                </a>
              </div>
            </div>
          </div>

          {/* ---- Bottom feeds ---- */}
          <RecentTrades symbol={symbol} up={up} onPin={focusRow} />
          <LiquidationFeed symbol={symbol} onPin={focusRow} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-[var(--role-content-subtle)]">{label}</p>
      <p className="text-sm font-bold tabular-nums" style={{ color: color ?? 'var(--role-content)' }}>{value}</p>
    </div>
  );
}

// Price to a fixed 2-decimal, comma-grouped string (85,952.00).
// Price with decimals that scale to magnitude — a fixed 2 decimals showed
// sub-cent coins (PUMP, FARTCOIN) as "0.00". Big coins keep 2, small coins get
// enough places to actually read the price.
const priceDecimals = (n: number): number => {
  const a = Math.abs(n);
  if (a >= 1000) return 2;
  if (a >= 1) return 2;
  if (a >= 0.1) return 4;
  if (a >= 0.001) return 5;
  if (a >= 0.00001) return 7;
  return 9;
};
const fmtPx = (n: number) => {
  const d = priceDecimals(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
// USD amount, compact like the reference: 92.91 / 2.50K / 1.39M.
const fmtUsdShort = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
};

// Hyperliquid-style vertical order book: asks on top, a mid-price row, bids
// below. Price / Size (USD) / Sum (USD) columns, gradient cumulative-depth bars
// growing from the Sum side, and a bid/ask imbalance bar at the bottom.
function OrderBook({ book, mark, last, up }: { book: OrderbookSnapshot | null; mark: number; last: number; up: boolean }) {
  const N = 12;
  const rawAsks = (book?.asks ?? []).slice(0, N); // ascending px (nearest mid first)
  const rawBids = (book?.bids ?? []).slice(0, N); // descending px (nearest mid first)

  // Cumulative USD summed from the mid outward, so the level nearest the mid
  // has the smallest Sum and the farthest has the largest (= full-width bar).
  let ackAsk = 0;
  const asks = rawAsks.map((l) => { const u = l.px * l.sz; ackAsk += u; return { px: l.px, usd: u, sum: ackAsk }; });
  let ackBid = 0;
  const bids = rawBids.map((l) => { const u = l.px * l.sz; ackBid += u; return { px: l.px, usd: u, sum: ackBid }; });
  const maxAsk = asks.length ? asks[asks.length - 1].sum : 1;
  const maxBid = bids.length ? bids[bids.length - 1].sum : 1;

  // Big center price = the live SSE price (ticks every print), falling back to
  // the order book's mid only when the live price isn't available yet.
  const mid = last || mark || book?.stats?.mid || 0;
  const bookMid = book?.stats?.mid ?? null; // order-book mid for the small line
  const bestBid = rawBids[0]?.px;
  const bestAsk = rawAsks[0]?.px;
  const spreadPct = bestBid && bestAsk && mid ? ((bestAsk - bestBid) / mid) * 100 : null;

  const total = maxAsk + maxBid;
  const bidPct = total > 0 ? (maxBid / total) * 100 : 50;
  const askPct = 100 - bidPct;

  const asksDisplay = [...asks].reverse(); // highest price at the top

  return (
    <div className="flex flex-col">
      <div className="flex items-center border-b border-[var(--role-line-subtle)] px-4 py-3">
        <h3 className="text-base font-bold text-[var(--role-content)]">Order Book</h3>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-4 pb-1.5 pt-2 text-[11px] font-medium text-[var(--role-content-subtle)]">
        <span>Price</span>
        <span className="text-right">Size (USD)</span>
        <span className="text-right">Sum (USD)</span>
      </div>

      {/* Ladder: asks, mid, bids — solid, natural full height (no scroll) */}
      <div>
        {!book ? (
          <div className="flex h-full items-center justify-center py-10 text-[11px] text-[var(--role-content-subtle)]">Loading book…</div>
        ) : (
          <>
            {asksDisplay.map((r, i) => <BookRow key={`a${i}`} row={r} max={maxAsk} side="ask" />)}

            {/* Mid / last price row */}
            <div className="flex items-center justify-between gap-2 border-y border-[var(--role-line-subtle)] px-4 py-2">
              <span
                className="flex items-center gap-1 text-lg font-bold tabular-nums"
                style={{ color: up ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)' }}
              >
                {fmtPx(mid)} <span className="text-sm">{up ? '↑' : '↓'}</span>
              </span>
              <span className="text-[11px] tabular-nums text-[var(--role-content-subtle)]">{bookMid != null ? `$${fmtPx(bookMid)}` : '—'}</span>
              <span className="text-[11px] tabular-nums text-[var(--role-content-subtle)]">{spreadPct != null ? `${spreadPct.toFixed(5)}%` : '—'}</span>
            </div>

            {bids.map((r, i) => <BookRow key={`b${i}`} row={r} max={maxBid} side="bid" />)}
          </>
        )}
      </div>

      {/* Bid / ask imbalance */}
      <div className="flex items-center gap-2 border-t border-[var(--role-line-subtle)] px-4 py-2 text-[11px] font-semibold tabular-nums">
        <span style={{ color: 'var(--role-signal-positive)' }}>B {bidPct.toFixed(2)}%</span>
        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--role-signal-negative)' }}>
          <span className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out" style={{ width: `${bidPct}%`, background: 'var(--role-signal-positive)' }} />
        </span>
        <span style={{ color: 'var(--role-signal-negative)' }}>{askPct.toFixed(2)}% S</span>
      </div>
    </div>
  );
}

function BookRow({ row, max, side }: { row: { px: number; usd: number; sum: number }; max: number; side: 'ask' | 'bid' }) {
  const pct = max > 0 ? (row.sum / max) * 100 : 0;
  const pxColor = side === 'bid' ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';
  const grad = side === 'bid'
    ? 'linear-gradient(to left, rgb(var(--pos-rgb) / 0.42), rgb(var(--pos-rgb) / 0.05))'
    : 'linear-gradient(to left, rgb(var(--neg-rgb) / 0.42), rgb(var(--neg-rgb) / 0.05))';
  return (
    <div className="relative grid grid-cols-[1fr_1fr_1fr] items-center gap-2 px-4 py-[3px] text-[11px] tabular-nums">
      {/* Depth bar animates its width as the book updates, so changes glide
          instead of snapping on each 3s poll. */}
      <div className="pointer-events-none absolute inset-y-0 right-0 transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: grad }} />
      <span className="relative font-medium transition-colors duration-300" style={{ color: pxColor }}>{fmtPx(row.px)}</span>
      <span className="relative text-right text-[var(--role-content)] transition-colors duration-300">{fmtUsdShort(row.usd)}</span>
      <span className="relative text-right text-[var(--role-content)] transition-colors duration-300">{fmtUsdShort(row.sum)}</span>
    </div>
  );
}

// Depth chart — cumulative bid/ask liquidity (USD) by price, meeting at the mid.
function DepthChart({ book }: { book: OrderbookSnapshot | null }) {
  const data = useMemo(() => {
    if (!book) return [] as { px: number; bid?: number; ask?: number }[];
    const bids = [...book.bids].sort((a, b) => b.px - a.px); // best (highest) first
    const asks = [...book.asks].sort((a, b) => a.px - b.px); // best (lowest) first
    let cb = 0;
    const bidRows = bids.map((l) => { cb += l.px * l.sz; return { px: l.px, bid: cb }; }).reverse();
    let ca = 0;
    const askRows = asks.map((l) => { ca += l.px * l.sz; return { px: l.px, ask: ca }; });
    return [...bidRows, ...askRows];
  }, [book]);

  if (!book) return <div className="flex h-full items-center justify-center text-sm text-[var(--role-content-subtle)]">Loading depth…</div>;
  if (data.length < 2) return <div className="flex h-full items-center justify-center text-sm text-[var(--role-content-subtle)]">Not enough depth.</div>;

  const axis = { fill: 'var(--role-content-subtle)', fontSize: 10 };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id="depthBid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--pos)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--pos)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="depthAsk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--neg)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--neg)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="px" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => `$${formatCompact(Number(v))}`} tick={axis} axisLine={{ stroke: 'var(--role-line-subtle)' }} tickLine={false} minTickGap={44} />
        <YAxis tickFormatter={(v) => `$${formatCompact(Number(v))}`} tick={axis} axisLine={{ stroke: 'var(--role-line-subtle)' }} tickLine={false} width={52} />
        <RTooltip
          contentStyle={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 11 }}
          labelFormatter={(v) => `$${fmtPx(Number(v))}`}
          formatter={(val: number, name: string) => [`$${formatCompact(val)}`, name === 'bid' ? 'Bid depth' : 'Ask depth']}
        />
        <Area type="stepAfter" dataKey="bid" stroke="var(--pos)" strokeWidth={1.75} fill="url(#depthBid)" connectNulls={false} isAnimationActive={false} />
        <Area type="stepBefore" dataKey="ask" stroke="var(--neg)" strokeWidth={1.75} fill="url(#depthAsk)" connectNulls={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
// `side` is the taker's side. Treat buy/long as the taker buying.
const isBuySide = (side: string) => /^(buy|long|b)$/i.test(side.trim());

// Row-count selector (10 / 25 / 50) for the feed tables.
function LimitToggle({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-[var(--role-surface-raised)] p-0.5">
      {[10, 25, 50].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={cn(
            'rounded px-2 py-0.5 text-[11px] font-semibold transition-colors',
            value === n ? 'bg-[var(--role-surface)] text-[var(--role-content)] shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
          )}
        >
          {n}
        </button>
      ))}
    </span>
  );
}

// Recent trade tape for the market — header stats (last price, buy/sell split,
// VWAP) plus a live table. Buyer/seller are derived from the taker's side.
function RecentTrades({ symbol, up, onPin }: { symbol: string; up: boolean; onPin: (e: FocusEvent) => void }) {
  const [trades, setTrades] = useState<MarketTrade[] | null>(null);
  const [limit, setLimit] = useState(25);
  useEffect(() => {
    let cancelled = false;
    const coin = coinOf(symbol);
    const load = () => analytics.getMarketTrades(coin, limit).then((t) => { if (!cancelled) setTrades(t); }).catch(() => {});
    load();
    const id = window.setInterval(load, 4000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [symbol, limit]);

  const rows = trades ?? [];
  const buys = rows.filter((t) => isBuySide(t.side)).length;
  const buyPct = rows.length ? (buys / rows.length) * 100 : 50;
  const sellPct = 100 - buyPct;
  const volSum = rows.reduce((s, t) => s + t.value, 0);
  const szSum = rows.reduce((s, t) => s + t.size, 0);
  // The stored `price` column is DECIMAL(20,2), so sub-cent coins (PUMP) round
  // to 0.00 — derive the real price from value/size, which are stored intact.
  const vwap = szSum > 0 ? volSum / szSum : 0;
  const lastPx = rows[0] && rows[0].size > 0 ? rows[0].value / rows[0].size : 0;
  const lastBuy = rows[0] ? isBuySide(rows[0].side) : up;

  return (
    <section className="border-t border-[var(--role-line-subtle)] px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--role-content)]">Recent Trades</h3>
        <LimitToggle value={limit} onChange={setLimit} />
      </div>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-[var(--role-line-subtle)] bg-[var(--role-background)]/40 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">Last Price</p>
          <p className="text-lg font-bold tabular-nums" style={{ color: lastBuy ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)' }}>${fmtPx(lastPx)}</p>
        </div>
        <div className="rounded-md border border-[var(--role-line-subtle)] bg-[var(--role-background)]/40 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">Buy / Sell</p>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full">
            <span style={{ width: `${buyPct}%`, background: 'var(--role-signal-positive)' }} />
            <span style={{ width: `${sellPct}%`, background: 'var(--role-signal-negative)' }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] font-semibold tabular-nums">
            <span style={{ color: 'var(--role-signal-positive)' }}>{buyPct.toFixed(0)}%</span>
            <span style={{ color: 'var(--role-signal-negative)' }}>{sellPct.toFixed(0)}%</span>
          </div>
        </div>
        <div className="rounded-md border border-[var(--role-line-subtle)] bg-[var(--role-background)]/40 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">VWAP</p>
          <p className="text-lg font-bold tabular-nums text-[var(--role-content)]">${fmtPx(vwap)}</p>
          <p className="text-[11px] text-[var(--role-content-subtle)]">Vol: ${formatCompact(volSum)}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[11px] tabular-nums">
          <thead>
            <tr className="text-left text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">
              <th className="py-1.5 pr-3">Time</th>
              <th className="py-1.5 pr-3">Direction</th>
              <th className="py-1.5 pr-3 text-right">Price</th>
              <th className="py-1.5 pr-3 text-right">Size</th>
              <th className="py-1.5 pr-3 text-right">Value</th>
              <th className="py-1.5 pr-3">Buyer</th>
              <th className="py-1.5">Seller</th>
            </tr>
          </thead>
          <tbody>
            {!trades ? (
              <tr><td colSpan={7} className="py-6 text-center text-[var(--role-content-subtle)]">Loading trades…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="py-6 text-center text-[var(--role-content-subtle)]">No recent trades.</td></tr>
            ) : rows.map((t, i) => {
              const buy = isBuySide(t.side);
              const buyer = buy ? t.taker : (t.maker ?? '');
              const seller = buy ? (t.maker ?? '') : t.taker;
              const col = buy ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';
              // Derive price from value/size (stored price rounds sub-cent to 0).
              const px = t.size > 0 ? t.value / t.size : 0;
              return (
                <tr
                  key={i}
                  onClick={() => onPin({ kind: 'trade', price: px, ts: t.timestamp, side: t.side, size: t.size, value: t.value })}
                  className="cursor-pointer border-t border-[var(--role-line-subtle)] transition-colors hover:bg-[var(--bg-secondary-20)]"
                >
                  <td className="py-1.5 pr-3 text-[var(--role-content-subtle)]">{new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false })}</td>
                  <td className="py-1.5 pr-3"><span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ color: col, borderColor: col }}>{buy ? 'BUY' : 'SELL'}</span></td>
                  <td className="py-1.5 pr-3 text-right font-medium" style={{ color: col }}>${fmtPx(px)}</td>
                  <td className="py-1.5 pr-3 text-right text-[var(--role-content)]">{t.size.toFixed(4)}</td>
                  <td className="py-1.5 pr-3 text-right text-[var(--role-content)]">${fmtUsdShort(t.value)}</td>
                  <td className="py-1.5 pr-3 text-[var(--role-content-subtle)]">{buyer ? formatAddress(buyer) : '—'}</td>
                  <td className="py-1.5 text-[var(--role-content-subtle)]">{seller ? formatAddress(seller) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Recent liquidation events for the market.
function LiquidationFeed({ symbol, onPin }: { symbol: string; onPin: (e: FocusEvent) => void }) {
  const [liqs, setLiqs] = useState<MarketLiquidation[] | null>(null);
  const [limit, setLimit] = useState(25);
  useEffect(() => {
    let cancelled = false;
    const coin = coinOf(symbol);
    const load = () => analytics.getMarketLiquidations(coin, limit).then((l) => { if (!cancelled) setLiqs(l); }).catch(() => {});
    load();
    const id = window.setInterval(load, 6000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [symbol, limit]);

  const rows = liqs ?? [];
  const isLong = (s: string) => /long|buy/i.test(s);

  return (
    <section className="border-t border-[var(--role-line-subtle)] px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--role-content)]">Liquidation Feed</h3>
        <LimitToggle value={limit} onChange={setLimit} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[11px] tabular-nums">
          <thead>
            <tr className="text-left text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">
              <th className="py-1.5 pr-3">Address</th>
              <th className="py-1.5 pr-3">Direction</th>
              <th className="py-1.5 pr-3 text-right">Value</th>
              <th className="py-1.5 pr-3 text-right">Price</th>
              <th className="py-1.5 pr-3 text-right">Size</th>
              <th className="py-1.5 text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {!liqs ? (
              <tr><td colSpan={6} className="py-6 text-center text-[var(--role-content-subtle)]">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-6 text-center text-[var(--role-content-subtle)]">No recent liquidations.</td></tr>
            ) : rows.map((l, i) => {
              const long = isLong(l.side);
              const col = long ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';
              const px = l.size > 0 ? l.value / l.size : 0; // derive (stored price rounds sub-cent to 0)
              return (
                <tr
                  key={i}
                  onClick={() => onPin({ kind: 'liq', price: px, ts: l.timestamp, side: l.side, size: l.size, value: l.value })}
                  className="cursor-pointer border-t border-[var(--role-line-subtle)] transition-colors hover:bg-[var(--bg-secondary-20)]"
                >
                  <td className="py-1.5 pr-3 text-[var(--role-content-subtle)]">{l.wallet ? formatAddress(l.wallet) : '—'}</td>
                  <td className="py-1.5 pr-3"><span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ color: col, borderColor: col }}>{long ? 'LONG LIQ' : 'SHORT LIQ'}</span></td>
                  <td className="py-1.5 pr-3 text-right text-[var(--role-content)]">${fmtUsdShort(l.value)}</td>
                  <td className="py-1.5 pr-3 text-right text-[var(--role-content)]">${fmtPx(px)}</td>
                  <td className="py-1.5 pr-3 text-right text-[var(--role-content)]">{l.size.toFixed(4)}</td>
                  <td className="py-1.5 text-right text-[var(--role-content-subtle)]">{timeAgo(l.timestamp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
