'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle, CandlestickData, UTCTimestamp, IPriceLine } from 'lightweight-charts';
import { X, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { analytics, wallet, formatNumber, formatCompact, marketStreamUrl, type Candle, type WalletFill } from '@/lib/api';
import { annotateFills } from '@/lib/positionWalk';

// ---------------------------------------------------------------------------
// PositionChartModal
//
// Modal that opens when the user clicks a position row on the wallet page.
// Shows OHLC candles for the position's market with three horizontal lines
// drawn on top:
//
//   - Entry price   (green for longs, red for shorts) — solid
//   - Mark price    (white)                            — dashed, subtle
//   - Liquidation   (red)                              — dashed, prominent
//
// The chart is the focal piece of BULK's tournament broadcast view: a
// streamer shows a wallet, clicks a position, and viewers can immediately
// see "they entered at X, getting closer to liq at Y."
//
// Built on lightweight-charts (already installed). Library is ~30KB gzipped
// and renders OHLC + price lines natively, so the integration is small.
// ---------------------------------------------------------------------------

// Live position — open in the wallet right now. Includes mark price and
// liquidation price (only meaningful for currently-open positions).
export interface LivePositionForChart {
  kind: 'live';
  walletAddress: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  size: number;
  leverage: number;
  unrealizedPnl: number;
}

// Closed position — finished trade pulled from the wallet's
// closed-position history. No mark or liq (those are live concepts);
// instead we have a closePrice and timestamps bounding the trade.
export interface ClosedPositionForChart {
  kind: 'closed';
  walletAddress: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;     // avgOpenPrice
  closePrice: number;     // avgClosePrice
  size: number;
  leverage: number;       // 0 if BULK didn't include it for closed positions
  realizedPnl: number;
  fees: number;
  funding: number;
  openedAt: number;       // ms epoch — start of trade
  closedAt: number;       // ms epoch — end of trade
  liquidated: boolean;
}

// What the modal renders. Discriminated by `kind` so the chart effect
// branches on live-vs-closed behavior cleanly. Older code using
// `PositionForChart` directly continues to work since the type is the
// union — pages just have to set `kind` when constructing the value.
export type PositionForChart = LivePositionForChart | ClosedPositionForChart;

interface Props {
  position: PositionForChart | null; // null = closed
  onClose: () => void;
}

// Available time intervals. Kept short so the chart is readable on a
// streaming feed; we don't need every interval BULK supports.
const INTERVALS: { id: string; label: string }[] = [
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '1h', label: '1H' },
  { id: '4h', label: '4H' },
  { id: '1d', label: '1D' },
];

const DEFAULT_INTERVAL = '1h';
const CANDLE_LIMIT = 200;

// Metadata stashed alongside each marker at render time, keyed by the
// marker's bucketed time (in seconds). Read by the crosshair-move handler
// to populate the hover tooltip. Kept outside React state because it
// doesn't drive rendering — only the ref's current value matters at
// callback time.

export function PositionChartModal({ position, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  // The PNL/Size badge is positioned by directly mutating this element's
  // style on every price-scale change. We deliberately bypass React state
  // here: range-change events fire dozens of times per second during a
  // zoom/pan gesture, and a setState per event would re-render the modal
  // mid-gesture and stutter the chart's canvas redraw.
  const badgeRef = useRef<HTMLDivElement | null>(null);
  // Live-update plumbing (live positions only). markLineRef is the mark
  // price line we mutate on each tick; liveBarRef is the in-progress last
  // candle we extend via series.update(); latestMarkRef holds the newest
  // mark price, flushed to the throttled header state on an interval.
  const markLineRef = useRef<IPriceLine | null>(null);
  const liveBarRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const latestMarkRef = useRef<number | null>(null);

  // Tracks whether the most recent mousedown on the modal originated on
  // the backdrop itself (vs. on a child like the chart canvas). Used to
  // suppress modal-close on clicks that ended up on the backdrop only
  // because the user dragged a chart axis past the panel boundary. See
  // the backdrop element below for the full rationale.
  const mouseDownOnBackdropRef = useRef(false);

  // Auto-pick a sensible default interval. For live we always start at
  // 1H. For closed positions we pick based on trade duration so a
  // 30-minute scalp doesn't render as one candle on a 1D chart, and a
  // multi-day swing doesn't render as 5000 5m candles.
  const initialInterval = (() => {
    if (!position || position.kind === 'live') return DEFAULT_INTERVAL;
    const durMs = position.closedAt - position.openedAt;
    const hours = durMs / (60 * 60_000);
    if (hours < 1) return '5m';
    if (hours < 6) return '15m';
    if (hours < 48) return '1h';
    if (hours < 240) return '4h';   // ~10 days
    return '1d';
  })();

  const [interval, setInterval] = useState(initialInterval);

  // Throttled live mark price (live positions only). null until the first
  // SSE tick arrives; the header falls back to the snapshot mark until then.
  const [liveMark, setLiveMark] = useState<number | null>(null);

  // Reset interval when the active position changes — otherwise switching
  // from a 5-minute scalp to a 5-day swing would keep the wrong interval.
  useEffect(() => {
    setInterval(initialInterval);
    setLiveMark(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [fills, setFills] = useState<WalletFill[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // BULK returns placeholder candles (zero/empty OHLC) for hours with no
  // trading — e.g. the testnet's quiet/upgrade stretches. lightweight-charts
  // plots those as empty index slots, which shows up as a blank "gap" in the
  // middle of the chart. Drop them so only real candles are plotted and they
  // sit adjacent (a genuinely flat candle keeps a valid >0 price, so it stays).
  const plottedCandles = useMemo(
    () =>
      (candles ?? []).filter(
        (c) =>
          Number.isFinite(c.o) && c.o > 0 &&
          Number.isFinite(c.h) && c.h > 0 &&
          Number.isFinite(c.l) && c.l > 0 &&
          Number.isFinite(c.c) && c.c > 0,
      ),
    [candles],
  );
  // Close on Esc — small UX nicety. Streamers using the keyboard expect this.
  useEffect(() => {
    if (!position) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [position, onClose]);

  // Lock body scroll while open. Without this the page behind scrolls
  // along with the modal and looks broken.
  useEffect(() => {
    if (!position) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [position]);

  // Fetch candles whenever the active position or interval changes.
  // For live positions we fetch the most recent N candles. For closed
  // positions we fetch a window centered on the trade's lifespan so the
  // chart always shows the relevant period (otherwise a trade that
  // closed days ago would render off-screen).
  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Time window for closed-position candles. We pad the trade's
    // lifespan by 25% on each side so users see context (price action
    // before entry, price action after exit). For very short trades we
    // floor the padding at 30 min so the chart isn't pixel-narrow.
    let timeWindow: { startTime?: number; endTime?: number } = {};
    if (position.kind === 'closed') {
      const dur = Math.max(position.closedAt - position.openedAt, 30 * 60_000);
      const pad = Math.max(dur * 0.25, 15 * 60_000);
      timeWindow = {
        startTime: position.openedAt - pad,
        endTime: position.closedAt + pad,
      };
    }

    analytics
      .getCandles(position.symbol, interval, CANDLE_LIMIT, timeWindow)
      .then((res) => {
        if (cancelled) return;
        setCandles(res.candles);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[PositionChartModal] candle fetch failed:', err);
        setError('Could not load chart');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [position, interval]);

  // Fetch the wallet's fill history for this market. Doesn't depend on
  // the interval — fills are point events, not aggregates. Fired once per
  // (wallet, symbol) pair. Failing silently here is fine: if fills can't
  // load, the chart still works, just without entry markers.
  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    setFills(null);

    wallet
      .getFills(position.walletAddress, { symbol: position.symbol, limit: 500 })
      .then((res) => {
        if (cancelled) return;
        setFills(res.fills || []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[PositionChartModal] fills fetch failed:', err);
        setFills([]); // don't block the chart on this
      });

    return () => {
      cancelled = true;
    };
  }, [position]);

  // Filter the wallet's full fill history down to just the fills that
  // belong to the position the user is looking at.
  //
  // - Live position: walk fills chronologically; find the most recent
  //   open / flip transition and slice from there. (Older fills come
  //   from positions that have since been closed.)
  // - Closed position: take fills within the trade's lifespan window
  //   [openedAt, closedAt] inclusive, with a 1s slop on each end to
  //   catch fills that landed exactly at the boundary.
  //
  // Both paths share the same shape — fills are annotated with action
  // labels so the hover tooltip can say "Open long" rather than just
  // "Buy". Memoized because it feeds both the header fill count and
  // the chart marker effect — same source of truth.
  const currentPositionFills = useMemo(() => {
    if (!fills || fills.length === 0 || !position) return [];
    const annotated = annotateFills(fills);

    if (position.kind === 'closed') {
      const SLOP = 1000;
      return annotated.filter(
        (f) =>
          f.timestamp >= position.openedAt - SLOP &&
          f.timestamp <= position.closedAt + SLOP
      );
    }

    for (let i = annotated.length - 1; i >= 0; i--) {
      const a = annotated[i].action;
      if (a === 'open' || a === 'flip') {
        return annotated.slice(i);
      }
    }
    return annotated;
  }, [fills, position]);

  // Build / rebuild the chart whenever candles arrive. We tear down and
  // recreate on every change rather than mutating in place — the data
  // doesn't change often (open modal, switch interval) and re-creation is
  // simpler than reconciling between intervals.
  //
  // IMPORTANT: lightweight-charts needs a non-zero width and height at
  // construction time, otherwise it renders blank. The modal opens via a
  // flex layout, and there's a brief window where the container's
  // `clientHeight` is still 0 because the browser hasn't laid out yet. To
  // handle that we (1) seed the chart with a fallback size, (2) immediately
  // re-apply the actual measured size after the next paint, and (3) wire a
  // ResizeObserver to keep it in sync afterwards.
  useEffect(() => {
    if (!position || !candles || !containerRef.current) return;

    // Tear down any previous chart instance.
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const container = containerRef.current;

    // Detect light mode at chart creation. Cleaner than threading a theme
    // prop through; lightweight-charts needs concrete colors anyway.
    const isLight =
      typeof document !== 'undefined' &&
      !document.documentElement.classList.contains('dark') &&
      document.documentElement.getAttribute('data-theme') !== 'dark';

    const gridColor = isLight ? 'rgba(115, 106, 108, 0.15)' : 'rgba(84, 74, 76, 0.15)';
    const borderColor = isLight ? 'rgba(115, 106, 108, 0.4)' : 'rgba(84, 74, 76, 0.4)';
    const textColor = isLight ? '#736A6C' : '#807678';

    // Seed with non-zero dimensions even if the container hasn't been
    // measured yet — chart will be resized to actual dimensions on the next
    // paint via the ResizeObserver below.
    const initialWidth = container.clientWidth || 800;
    const initialHeight = container.clientHeight || 420;

    const chart = createChart(container, {
      width: initialWidth,
      height: initialHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor,
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: 1, // normal crosshair
      },
      rightPriceScale: {
        borderColor,
      },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: '#00B481',
      downColor: '#EF4A3C',
      borderUpColor: '#00B481',
      borderDownColor: '#EF4A3C',
      wickUpColor: '#00B481',
      wickDownColor: '#EF4A3C',
    });
    seriesRef.current = series;

    // Convert BULK kline shape to lightweight-charts CandlestickData.
    // BULK uses ms timestamps; lightweight-charts expects seconds (Unix).
    // plottedCandles has already dropped the empty no-trade filler candles.
    const data: CandlestickData[] = plottedCandles.map((c) => ({
      time: Math.floor(c.t / 1000) as UTCTimestamp,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));
    series.setData(data);

    // Seed the in-progress bar with the most recent candle so live ticks
    // extend it (rather than dropping the first tick into a fresh bar).
    if (plottedCandles.length > 0) {
      const lc = plottedCandles[plottedCandles.length - 1];
      liveBarRef.current = {
        time: Math.floor(lc.t / 1000),
        open: lc.o,
        high: lc.h,
        low: lc.l,
        close: lc.c,
      };
    }

    // Horizontal price lines, BULK-style: thin lines with colored axis
    // tags. Entry (side-colored dashed) + the floating PNL/Size badge,
    // Liq (amber dashed), Mark (green dotted) for live; Close for closed.
    series.createPriceLine({
      price: position.entryPrice,
      color: position.side === 'long' ? '#00B481' : '#EF4A3C',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Entry',
    });

    if (position.kind === 'live') {
      // Keep a handle on the mark line so live ticks can move it in place
      // (applyOptions) instead of recreating it.
      markLineRef.current = series.createPriceLine({
        price: position.markPrice,
        color: '#00B481',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'Mark',
      });

      if (position.liquidationPrice > 0) {
        series.createPriceLine({
          price: position.liquidationPrice,
          color: '#F5A623',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Liq.',
        });
      }
    } else {
      // Closed position: draw the close price as the second reference
      // line, colored by win/loss so users see "did this trade work"
      // at a glance (green=profit, red=loss).
      const wasProfitable =
        (position.side === 'long' && position.closePrice > position.entryPrice) ||
        (position.side === 'short' && position.closePrice < position.entryPrice);
      series.createPriceLine({
        price: position.closePrice,
        color: wasProfitable ? '#00B481' : '#EF4A3C',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Close',
      });
    }

    // Fill markers removed — the chart now mirrors BULK's clean reference
    // view: Entry / Mark / Liq lines plus a floating PNL/Size badge on the
    // entry line. Per-fill detail lives in the trades table, not the chart.
    series.setMarkers([]);

    // Fit time range immediately and again after the first paint, in case
    // the container was 0px when we created the chart and it's now real.
    chart.timeScale().fitContent();

    // Glue the PNL/Size badge to the entry line every animation frame.
    // lightweight-charts has no "price scale changed" event, so dragging the
    // price axis (vertical zoom) wouldn't otherwise reposition the badge.
    // A rAF loop keeps it locked to the line through any pan / zoom /
    // price-drag / autoscale. Crucially we move it with `transform`
    // (translateY) and toggle it with `opacity` — both compositor-only — so
    // there's no per-frame layout reflow fighting the chart's canvas redraw
    // during a drag. No React re-render either.
    let lastBadgeY = Number.NaN;
    let badgeShown = false;
    const recomputeBadge = () => {
      const s = seriesRef.current;
      const el = badgeRef.current;
      if (!s || !el) return;
      const y = s.priceToCoordinate(position.entryPrice);
      const h = containerRef.current?.clientHeight ?? 0;
      const show = typeof y === 'number' && y >= 0 && (h === 0 || y <= h);
      if (show) {
        const top = Math.round((y as number) + 8 /* p-2 padding */);
        if (top !== lastBadgeY) {
          // translate(-50%) keeps it horizontally centered on left:58%;
          // translateY(-50%) centers it on the line; translateY(top) places it.
          el.style.transform = `translate(-50%, -50%) translateY(${top}px)`;
          lastBadgeY = top;
        }
        if (!badgeShown) { el.style.opacity = '1'; badgeShown = true; }
      } else if (badgeShown) {
        el.style.opacity = '0';
        badgeShown = false;
      }
    };
    let badgeRaf = requestAnimationFrame(function loop() {
      recomputeBadge();
      badgeRaf = requestAnimationFrame(loop);
    });

    // Apply the *actual* measured size as soon as the browser has laid out.
    // Using requestAnimationFrame ensures we read clientWidth/Height after
    // the layout pass that follows this useEffect.
    const raf = requestAnimationFrame(() => {
      if (containerRef.current && chart) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w > 0 && h > 0) {
          chart.applyOptions({ width: w, height: h });
          chart.timeScale().fitContent();
          recomputeBadge();
        }
      }
    });

    // Resize observer — keeps the chart sized to its container when the
    // modal resizes (e.g. window resize or theme switch shifting layout).
    const resize = () => {
      if (containerRef.current && chart) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w > 0 && h > 0) {
          chart.applyOptions({ width: w, height: h });
          recomputeBadge();
        }
      }
    };
    const obs = new ResizeObserver(resize);
    obs.observe(container);

    // --- Live updates (live positions only) -------------------------------
    // Open an SSE stream of mark/last prices for this symbol while the modal
    // is mounted. Chart updates go through the imperative lightweight-charts
    // API (series.update / priceLine.applyOptions) so they never trigger a
    // React re-render; the header mark is throttled to a few updates/sec.
    let es: EventSource | null = null;
    let headerFlush: number | null = null;
    if (position.kind === 'live') {
      const bucketSec =
        interval === '5m' ? 300 :
        interval === '15m' ? 900 :
        interval === '1h' ? 3600 :
        interval === '4h' ? 14400 :
        interval === '1d' ? 86400 : 3600;

      es = new EventSource(marketStreamUrl(position.symbol));
      es.onmessage = (ev) => {
        let msg: { price: number; kind: string; ts: number };
        try { msg = JSON.parse(ev.data); } catch { return; }
        const price = Number(msg.price);
        if (!(price > 0)) return;
        const s = seriesRef.current;
        if (!s) return;

        // Extend / append the in-progress candle from any price print.
        const tSec = Math.floor((msg.ts || Date.now()) / 1000);
        const bucketStart = Math.floor(tSec / bucketSec) * bucketSec;
        const bar = liveBarRef.current;
        if (!bar || bucketStart > bar.time) {
          const nb = { time: bucketStart, open: price, high: price, low: price, close: price };
          liveBarRef.current = nb;
          s.update({ time: nb.time as UTCTimestamp, open: nb.open, high: nb.high, low: nb.low, close: nb.close });
        } else if (bucketStart === bar.time) {
          bar.close = price;
          if (price > bar.high) bar.high = price;
          if (price < bar.low) bar.low = price;
          s.update({ time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
        }
        // else: stale (older than current bar) — ignore.

        // Mark ticks move the mark line + feed the throttled header.
        if (msg.kind === 'mark') {
          markLineRef.current?.applyOptions({ price });
          latestMarkRef.current = price;
        }
      };
      // Don't spam the console on transient reconnects — EventSource retries
      // on its own (server sends `retry:`).
      es.onerror = () => { /* auto-reconnect handled by EventSource */ };

      // Flush the newest mark into React state a few times a second.
      headerFlush = window.setInterval(() => {
        const m = latestMarkRef.current;
        if (m != null) setLiveMark((prev) => (prev === m ? prev : m));
      }, 300);
    }

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      if (es) { es.close(); es = null; }
      if (headerFlush) { window.clearInterval(headerFlush); headerFlush = null; }
      markLineRef.current = null;
      liveBarRef.current = null;
      latestMarkRef.current = null;
      cancelAnimationFrame(badgeRaf);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [plottedCandles, fills, currentPositionFills, position, interval]);

  if (!position) return null;

  // Effective mark for live positions: the latest streamed mark if we have
  // one, else the snapshot value the modal opened with. Drives the header
  // Mark/Notional/distance and the PNL badge so they tick in real time.
  const effMark = position.kind === 'live' ? (liveMark ?? position.markPrice) : position.closePrice;

  // PnL to display. For live positions, anchor to BULK's exact unrealized
  // PnL at open and adjust by the mark delta since (so funding/fees baked
  // into the snapshot aren't lost). Closed positions show realized PnL.
  const displayPnl =
    position.kind === 'live'
      ? position.unrealizedPnl + (position.side === 'long' ? 1 : -1) * (effMark - position.markPrice) * position.size
      : position.realizedPnl;

  // Pre-compute distance-to-liq for live positions (only meaningful while
  // the position is open). Closed positions use their realized PnL story
  // for the same horizontal screen real estate.
  const distanceToLiqPct =
    position.kind === 'live' &&
    position.liquidationPrice > 0 &&
    effMark > 0
      ? Math.abs((effMark - position.liquidationPrice) / effMark) * 100
      : null;

  return (
    <div
      // Backdrop close handling.
      //
      // Previous version used onClick={onClose} which had a subtle bug:
      // when a user drags on the chart axis (to zoom) and releases their
      // mouse outside the chart but still inside the modal, the synthetic
      // `click` event sometimes bubbles to the backdrop and closes the
      // modal — destroying their zoom gesture.
      //
      // Fix: track where the mousedown started. If it started inside the
      // panel, suppress the next click on the backdrop. Only fresh
      // backdrop-originated clicks close the modal. This is the standard
      // "drag-resistant click" pattern used by Material UI, Radix, etc.
      onMouseDown={(e) => {
        // The backdrop is the click target only if the user genuinely
        // pressed on it (not on a child). e.target === e.currentTarget
        // means the event originated on the backdrop element itself.
        mouseDownOnBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Only close when both the mousedown AND the click happened on
        // the backdrop. Clicks bubbled up from inside the panel are
        // suppressed (their mousedown was inside the panel).
        if (mouseDownOnBackdropRef.current && e.target === e.currentTarget) {
          onClose();
        }
        mouseDownOnBackdropRef.current = false;
      }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        // No more stopPropagation needed — the backdrop's mousedown-tracking
        // handles drag-out clicks correctly. Keeping it would also work
        // but isn't necessary; we leave it off so React can properly track
        // the click target chain.
        className="relative w-full max-w-[90vw] max-h-[90vh] bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                position.side === 'long'
                  ? 'bg-bulk-green/15 text-bulk-green'
                  : 'bg-bulk-red/15 text-bulk-red'
              }`}
            >
              {position.side === 'long' ? (
                <span className="inline-flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Long
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" />
                  Short
                </span>
              )}
            </span>
            <h2 className="text-lg font-semibold">{position.symbol}</h2>
            <span className="text-sm text-[var(--text-tertiary)]">
              {position.leverage > 0 && `${position.leverage}× · `}
              {formatNumber(position.size, 4)} units
              {position.kind === 'closed' && (
                <>
                  {' · '}
                  <span className={position.liquidated ? 'text-bulk-orange' : ''}>
                    {position.liquidated ? 'LIQUIDATED' : 'CLOSED'}
                  </span>
                  {' '}
                  {new Date(position.closedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </>
              )}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--bg-secondary-20)]/50 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stat strip — different stats per kind:
            - live:   Entry, Mark, Liquidation, Notional, Unrealized PnL, PnL %
            - closed: Entry, Close, Held, Notional, Realized PnL, ROI %
            Six stats fit comfortably in the wider modal — gives the
            trader a complete read on position economics without leaving
            the chart view. */}
        {position.kind === 'live' ? (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-[var(--border-color)]/40 border-b border-[var(--border-color)]">
            <Stat label="Entry" value={`$${formatNumber(position.entryPrice, 2)}`} />
            <Stat label="Mark" value={`$${formatNumber(effMark, 2)}`} />
            <Stat
              label="Liquidation"
              value={
                position.liquidationPrice > 0
                  ? `$${formatNumber(position.liquidationPrice, 2)}`
                  : '—'
              }
              valueClass="text-bulk-red"
              sublabel={
                distanceToLiqPct !== null
                  ? `${distanceToLiqPct.toFixed(2)}% away`
                  : undefined
              }
            />
            {/* Notional = size × mark — the dollar exposure of the position.
                Doesn't change with PnL; complements Mark by translating
                price into "how big is this bet really". */}
            <Stat
              label="Notional"
              value={`$${formatCompact(Math.abs(position.size * effMark))}`}
              sublabel={
                position.leverage > 0
                  ? `Margin $${formatCompact(Math.abs(position.size * effMark) / position.leverage)}`
                  : undefined
              }
            />
            <Stat
              label="Unrealized PnL"
              value={`${displayPnl >= 0 ? '+' : ''}$${formatNumber(displayPnl, 2)}`}
              valueClass={displayPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red'}
            />
            {/* PnL % = PnL / margin (true return on capital risked).
                Falls back to PnL / notional when leverage isn't known. */}
            <Stat
              label="PnL %"
              value={(() => {
                const notional = Math.abs(position.size * position.entryPrice);
                if (notional === 0) return '—';
                // Prefer return-on-margin (the leveraged ROI) since it
                // matches what traders mean when they say "this trade is
                // up X%". Falls back to return-on-notional if we don't
                // have leverage on the live snapshot.
                const denom = position.leverage > 0 ? notional / position.leverage : notional;
                const pct = (displayPnl / denom) * 100;
                return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
              })()}
              valueClass={displayPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red'}
            />
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-px bg-[var(--border-color)]/40 border-b border-[var(--border-color)]">
            <Stat label="Entry" value={`$${formatNumber(position.entryPrice, 2)}`} />
            <Stat
              label="Close"
              value={`$${formatNumber(position.closePrice, 2)}`}
              valueClass={
                (position.side === 'long'
                  ? position.closePrice > position.entryPrice
                  : position.closePrice < position.entryPrice)
                  ? 'text-bulk-green'
                  : 'text-bulk-red'
              }
            />
            {/* "Held" stat removed — BULK reports openTime === closeTime
                on closed positions, so duration always reads as instant.
                Restore when BULK ships the fix post-competition. */}
            {/* Notional at entry. Sublabel intentionally omitted: BULK's
                per-position fees/funding are wallet-cumulative (not
                per-position), so a "Fees $X" line here would mislead.
                Lifetime fees are surfaced on the wallet Overview rail. */}
            <Stat
              label="Notional"
              value={`$${formatCompact(Math.abs(position.size * position.entryPrice))}`}
            />
            <Stat
              label="Realized PnL"
              value={`${position.realizedPnl >= 0 ? '+' : ''}$${formatNumber(position.realizedPnl, 2)}`}
              valueClass={position.realizedPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red'}
            />
            {/* ROI % — closed positions don't carry leverage from BULK
                (confirmed via curl 2026-05-22), so we can only show
                return-on-notional. Documented limitation; will become
                return-on-margin if BULK ever adds the field. */}
            <Stat
              label="ROI %"
              value={(() => {
                const notional = Math.abs(position.size * position.entryPrice);
                if (notional === 0) return '—';
                const pct = (position.realizedPnl / notional) * 100;
                return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
              })()}
              valueClass={position.realizedPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red'}
            />
          </div>
        )}

        {/* Interval selector */}
        <div className="flex items-center gap-1 p-3 border-b border-[var(--border-color)]/40">
          {INTERVALS.map((iv) => (
            <button
              key={iv.id}
              onClick={() => setInterval(iv.id)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                interval === iv.id
                  ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {iv.label}
            </button>
          ))}
          <div className="ml-auto text-xs text-[var(--text-tertiary)] flex items-center gap-2">
            {loading && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Loading…</span>
              </>
            )}
            {error && <span className="text-bulk-red">{error}</span>}
            {!loading && !error && candles && (
              <span>
                <span className="font-mono">{plottedCandles.length}</span> candles
                {/* Three states for fills, distinct from candles loading:
                    - null  → still fetching (no badge, avoid layout flicker)
                    - []    → loaded but empty (show subtle "no fills" hint
                              so the user knows nothing was hidden)
                    - >0    → render the count of fills *for this position*
                    The count uses currentPositionFills (filtered to just
                    the currently-open trade), not the raw fill history,
                    so it matches what the user sees on the chart. */}
                {fills === null ? null : currentPositionFills.length === 0 ? (
                  <span className="text-[var(--text-tertiary)] ml-2">
                    · no fills for this position
                  </span>
                ) : (
                  <>
                    {' · '}
                    <span className="font-mono">{currentPositionFills.length}</span> fill
                    {currentPositionFills.length === 1 ? '' : 's'}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Chart container. Explicit height (not flex-1) so the container
            has a measurable size before lightweight-charts is constructed.
            On large screens this is 60vh-ish; on small screens it falls
            back to 360px so the chart is always usable. */}
        <div className="h-[65vh] max-h-[720px] min-h-[420px] p-2 relative">
          <div ref={containerRef} className="w-full h-full" />

          {/* PNL / Size badge — floats on the entry line, BULK-style.
              Always mounted; positioned and shown/hidden via badgeRef in
              recomputeBadge (direct style mutation, no re-render). */}
          {(() => {
            const pnl = displayPnl;
            const positive = pnl >= 0;
            return (
              <div
                ref={badgeRef}
                className="absolute z-10 pointer-events-none"
                style={{ left: '58%', top: 0, opacity: 0, willChange: 'transform, opacity' }}
              >
                <span
                  className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-lg whitespace-nowrap ${positive ? 'bg-bulk-green' : 'bg-bulk-red'}`}
                >
                  PNL {positive ? '+' : '-'}${formatNumber(Math.abs(pnl), 2)} | Size {formatNumber(position.size, 4)}
                </span>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  sublabel,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sublabel?: string;
}) {
  return (
    <div className="bg-[var(--bg-muted)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className={`text-base font-mono font-medium mt-0.5 ${valueClass ?? 'text-[var(--text-primary)]'}`}>
        {value}
      </div>
      {sublabel && (
        <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{sublabel}</div>
      )}
    </div>
  );
}
