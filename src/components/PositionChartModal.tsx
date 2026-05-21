'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle, UTCTimestamp, CandlestickData, SeriesMarker, Time, MouseEventParams } from 'lightweight-charts';
import { X, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { analytics, wallet, formatNumber, type Candle, type WalletFill } from '@/lib/api';
import { annotateFills, formatDuration } from '@/lib/positionWalk';

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
interface MarkerInfo {
  isBuy: boolean;
  isLiqOrAdl: boolean;
  count: number;
  totalSize: number;
  avgPrice: number;
  /** First fill's action label, e.g. "Open long", "Close short". */
  actionLabel: string;
  /** Original (unbucketed) timestamp of the first fill in the group. */
  timestamp: number;
}

export function PositionChartModal({ position, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  // Marker metadata indexed by marker time (UTCTimestamp seconds). Populated
  // when fills load; consumed by the crosshair-move handler to render the
  // hover tooltip with action label, count, size, etc.
  const markerInfoRef = useRef<Map<number, MarkerInfo>>(new Map());

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

  // Reset interval when the active position changes — otherwise switching
  // from a 5-minute scalp to a 5-day swing would keep the wrong interval.
  useEffect(() => {
    setInterval(initialInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [fills, setFills] = useState<WalletFill[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hover tooltip — shown when the crosshair lands on a marker's time bucket.
  // Tracks viewport-relative pixel position so we can absolutely-position
  // the tooltip div over the chart container.
  const [tooltip, setTooltip] = useState<{
    info: MarkerInfo;
    x: number;
    y: number;
  } | null>(null);

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
    const markLineColor = isLight ? '#1B1A14' : '#FFFEEF';

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
    const data: CandlestickData[] = candles.map((c) => ({
      time: Math.floor(c.t / 1000) as UTCTimestamp,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
    }));
    series.setData(data);

    // Horizontal price lines. Different sets per kind:
    //   - live  → Entry (solid, side-colored), Mark (dashed grey), Liq (dashed red)
    //   - closed → Entry (solid, side-colored), Close (solid grey), no Liq
    series.createPriceLine({
      price: position.entryPrice,
      color: position.side === 'long' ? '#00B481' : '#EF4A3C',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: 'Entry',
    });

    if (position.kind === 'live') {
      series.createPriceLine({
        price: position.markPrice,
        color: markLineColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Mark',
      });

      if (position.liquidationPrice > 0) {
        series.createPriceLine({
          price: position.liquidationPrice,
          color: '#EF4A3C',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Liq',
        });
      }
    } else {
      // Closed position: draw the close price as the second reference
      // line. Color it by win/loss so users see "did this trade work"
      // at a glance (green=profit, red=loss) without reading numbers.
      // Solid line because, unlike Mark, this is a fixed historical
      // value — not a moving target.
      const wasProfitable =
        (position.side === 'long' && position.closePrice > position.entryPrice) ||
        (position.side === 'short' && position.closePrice < position.entryPrice);
      series.createPriceLine({
        price: position.closePrice,
        color: wasProfitable ? '#00B481' : '#EF4A3C',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'Close',
      });
    }

    // Fill markers — wallet's executed trades on this market, painted on
    // the candle chart so users see the position's trade story at a glance.
    //
    // Visual rules:
    //   - Buys → green circles labeled "B" below the bar
    //   - Sells → red circles labeled "S" above the bar
    //   - Liquidations / ADL / Sweeps → orange circles labeled "LIQ" / "ADL" / "LSWP"
    //   - Aggregated buckets (multiple fills in same candle, same side,
    //     same reason) show "B ×N" / "S ×N" instead
    //
    // We aggregate fills by (timeBucket, side, reason) so a flurry of
    // small fills against multiple makers in the same minute becomes
    // one readable marker instead of a vertical wall of text.
    //
    // BULK v1.0.15 added `liq_sweep` (reasonCode 3) — a partial-liquidation
    // cascade. We treat it as liquidation-flavored (same orange palette)
    // but with a distinct "LSWP" label so users can tell at a glance
    // whether a position was force-closed in one shot (LIQ) or via
    // multiple partial sweeps (LSWP).
    //
    // Detailed metadata (action label, exact size, exact price, time)
    // is stored in chartMarkerInfoRef and shown in a custom hover
    // tooltip via subscribeCrosshairMove below.
    if (fills && fills.length > 0) {
      // Bucket size in seconds — must match the chart interval so fills
      // within the same candle group together.
      const bucketSeconds: Record<string, number> = {
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400,
      };
      const bucket = bucketSeconds[interval] ?? 3600;

      // Annotate every fill with its position-state action so the hover
      // tooltip can say "Open long: 0.5 @ 81200" rather than just
      // "Buy 0.5 @ 81200". This walks the fills once chronologically.
      const annotated = annotateFills(fills);

      // currentPositionFills (computed in the useMemo above) is already
      // sliced to only the fills from the currently-open position.
      // Reuse it directly so the marker logic stays in sync with the
      // header's fill count.
      const currentPosFills = currentPositionFills;

      // Group annotated fills by (timeBucket, side, reason). We iterate
      // over `currentPosFills` (already filtered to the currently
      // open position) so previously-closed positions don't show up
      // on the chart.
      type Group = {
        time: number;
        isBuy: boolean;
        reason: string;
        fills: typeof annotated;
      };
      const groups = new Map<string, Group>();
      for (const f of currentPosFills) {
        const tSec = Math.floor(f.timestamp / 1000);
        const tBucket = Math.floor(tSec / bucket) * bucket;
        const reason = (f.reasonCode || 'trade').toLowerCase();
        const key = `${tBucket}|${f.isBuy ? 'B' : 'S'}|${reason}`;
        const g = groups.get(key);
        if (g) {
          g.fills.push(f);
        } else {
          groups.set(key, {
            time: tBucket,
            isBuy: f.isBuy,
            reason,
            fills: [f],
          });
        }
      }

      // Build markers + a parallel info map for hover. The map key is
      // the marker time (seconds) — lightweight-charts gives us this
      // back in the crosshair callback.
      const infoMap = new Map<number, MarkerInfo>();
      const markers: SeriesMarker<Time>[] = Array.from(groups.values())
        .map((g) => {
          // `liq_sweep` is liquidation-flavored — share the orange palette
          // with LIQ and ADL so users can spot all force-close events at
          // a glance. The label text below distinguishes the three.
          const isLiqOrAdl = g.reason === 'liq' || g.reason === 'adl' || g.reason === 'liq_sweep';
          const color = isLiqOrAdl
            ? '#FFB547'
            : g.isBuy
            ? '#00B481'
            : '#EF4A3C';

          // Label strategy: text on the chart is expensive — every label
          // crowds out chart real estate, and with 500 fills compressed
          // into 30 minutes the labels become unreadable noise.
          //
          // Solution: pure circles for normal buy/sell fills. The tooltip
          // (subscribeCrosshairMove below) provides full context on hover.
          // Only liquidations, ADLs, and sweeps get an on-chart label
          // because those are rare, important events worth flagging visually.
          const text = isLiqOrAdl
            ? g.reason === 'liq'
              ? g.fills.length > 1 ? `LIQ ×${g.fills.length}` : 'LIQ'
              : g.reason === 'liq_sweep'
              ? g.fills.length > 1 ? `LSWP ×${g.fills.length}` : 'LSWP'
              : g.fills.length > 1 ? `ADL ×${g.fills.length}` : 'ADL'
            : undefined;

          // Compute aggregated metadata for the tooltip. VWAP across the
          // group's fills, total size, and the action of the *first*
          // fill in the group (the one that opened/added to the position).
          let totalSize = 0;
          let weightedPriceSum = 0;
          for (const f of g.fills) {
            totalSize += f.size;
            weightedPriceSum += f.size * f.price;
          }
          const avgPrice = totalSize > 0 ? weightedPriceSum / totalSize : 0;
          const primary = g.fills[0];

          infoMap.set(g.time, {
            isBuy: g.isBuy,
            isLiqOrAdl,
            count: g.fills.length,
            totalSize,
            avgPrice,
            actionLabel: primary.actionLabel,
            timestamp: primary.timestamp,
          });

          return {
            time: g.time as UTCTimestamp,
            position: g.isBuy ? 'belowBar' : 'aboveBar',
            color,
            shape: 'circle' as const,
            // Bigger circles for liq/adl so they pop visually even
            // without scanning labels. lightweight-charts default size
            // is 1; 2 is noticeably larger but still in scale.
            size: isLiqOrAdl ? 2 : 1,
            text,
          } as SeriesMarker<Time>;
        })
        .sort((a, b) => (a.time as number) - (b.time as number));

      series.setMarkers(markers);
      markerInfoRef.current = infoMap;
    } else {
      // Clear out any stale info from a previous render
      markerInfoRef.current = new Map();
    }

    // Fit time range immediately and again after the first paint, in case
    // the container was 0px when we created the chart and it's now real.
    chart.timeScale().fitContent();

    // Hover tooltip wiring. Subscribe to crosshair movement and look up
    // marker metadata by the time the cursor is over. We tolerate small
    // bucket misalignment (the marker time is bucketed to the candle,
    // but the cursor time is the candle's open time) by snapping to the
    // nearest known marker bucket within +/- one candle interval.
    const bucketSec = (() => {
      switch (interval) {
        case '5m': return 300;
        case '15m': return 900;
        case '1h': return 3600;
        case '4h': return 14400;
        case '1d': return 86400;
        default: return 3600;
      }
    })();

    const handleCrosshair = (param: MouseEventParams) => {
      // Empty point or off-chart → hide tooltip
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setTooltip(null);
        return;
      }
      const cursorSec = Number(param.time);
      // Find the closest marker bucket within one candle interval. We
      // snap because lightweight-charts reports the candle's time, not
      // the exact marker time, so equality won't work directly.
      let best: { time: number; info: MarkerInfo } | null = null;
      for (const [time, info] of markerInfoRef.current.entries()) {
        const dt = Math.abs(time - cursorSec);
        if (dt <= bucketSec / 2) {
          if (!best || dt < Math.abs(best.time - cursorSec)) {
            best = { time, info };
          }
        }
      }
      if (!best) {
        setTooltip(null);
        return;
      }
      // Position tooltip next to cursor. We offset slightly so the tip
      // doesn't sit directly under the cursor (which would steal hover).
      setTooltip({
        info: best.info,
        x: param.point.x + 16,
        y: param.point.y + 16,
      });
    };
    chart.subscribeCrosshairMove(handleCrosshair);

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
        }
      }
    };
    const obs = new ResizeObserver(resize);
    obs.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      try {
        chart.unsubscribeCrosshairMove(handleCrosshair);
      } catch {
        /* chart may already be removed */
      }
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setTooltip(null);
    };
  }, [candles, fills, currentPositionFills, position, interval]);

  if (!position) return null;

  // Pre-compute distance-to-liq for live positions (only meaningful while
  // the position is open). Closed positions use their realized PnL story
  // for the same horizontal screen real estate.
  const distanceToLiqPct =
    position.kind === 'live' &&
    position.liquidationPrice > 0 &&
    position.markPrice > 0
      ? Math.abs((position.markPrice - position.liquidationPrice) / position.markPrice) * 100
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
        className="relative w-full max-w-5xl max-h-[90vh] bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl flex flex-col overflow-hidden"
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
            - live: Entry, Mark, Liquidation, Unrealized PnL
            - closed: Entry, Close, Held duration, Realized PnL */}
        {position.kind === 'live' ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--border-color)]/40 border-b border-[var(--border-color)]">
            <Stat label="Entry" value={`$${formatNumber(position.entryPrice, 2)}`} />
            <Stat label="Mark" value={`$${formatNumber(position.markPrice, 2)}`} />
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
            <Stat
              label="Unrealized PnL"
              value={`${position.unrealizedPnl >= 0 ? '+' : ''}$${formatNumber(position.unrealizedPnl, 2)}`}
              valueClass={position.unrealizedPnl >= 0 ? 'text-bulk-green' : 'text-bulk-red'}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--border-color)]/40 border-b border-[var(--border-color)]">
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
            <Stat
              label="Held"
              value={formatDuration(position.closedAt - position.openedAt)}
              sublabel={
                position.fees > 0 || position.funding !== 0
                  ? `Fees $${formatNumber(position.fees, 2)}${
                      position.funding !== 0
                        ? ` · Funding ${position.funding >= 0 ? '+' : ''}$${formatNumber(position.funding, 2)}`
                        : ''
                    }`
                  : undefined
              }
            />
            <Stat
              label="Realized PnL"
              value={`${position.realizedPnl >= 0 ? '+' : ''}$${formatNumber(position.realizedPnl, 2)}`}
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
                <span className="font-mono">{candles.length}</span> candles
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
        <div className="h-[60vh] max-h-[560px] min-h-[360px] p-2 relative">
          <div ref={containerRef} className="w-full h-full" />

          {/* Hover tooltip — appears when crosshair lands on a marker.
              Absolutely positioned over the chart at the cursor offset
              tracked by the crosshair-move handler. Pointer-events:none
              so it never steals interaction from the chart underneath. */}
          {tooltip && (
            <div
              className="absolute z-10 pointer-events-none bg-[var(--bg-base)] border border-[var(--border-color)] rounded-lg shadow-2xl px-3 py-2 text-xs"
              style={{
                left: tooltip.x + 8 /* chart container has p-2 padding */,
                top: tooltip.y + 8,
                maxWidth: 260,
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                    tooltip.info.isLiqOrAdl
                      ? 'bg-bulk-orange/20 text-bulk-orange'
                      : tooltip.info.isBuy
                      ? 'bg-bulk-green/20 text-bulk-green'
                      : 'bg-bulk-red/20 text-bulk-red'
                  }`}
                >
                  {tooltip.info.isLiqOrAdl
                    ? '!'
                    : tooltip.info.isBuy
                    ? 'B'
                    : 'S'}
                </span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {tooltip.info.actionLabel}
                </span>
                {tooltip.info.count > 1 && (
                  <span className="text-[var(--text-tertiary)]">
                    ×{tooltip.info.count}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--text-secondary)] tabular-nums">
                <div>
                  <span className="text-[var(--text-tertiary)]">Size: </span>
                  {formatNumber(tooltip.info.totalSize, 4)}
                </div>
                <div>
                  <span className="text-[var(--text-tertiary)]">Price: </span>
                  ${formatNumber(tooltip.info.avgPrice, 2)}
                </div>
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                {new Date(tooltip.info.timestamp).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' · '}
                {formatDuration(Date.now() - tooltip.info.timestamp)} ago
              </div>
            </div>
          )}
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
