'use client';

import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle, UTCTimestamp, CandlestickData } from 'lightweight-charts';
import { X, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { analytics, formatNumber, type Candle } from '@/lib/api';

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

export interface PositionForChart {
  symbol: string;          // e.g. "BTC-USD"
  side: 'long' | 'short';  // derived from sign of size
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  size: number;            // absolute size (display)
  leverage: number;
  unrealizedPnl: number;
}

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

export function PositionChartModal({ position, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [interval, setInterval] = useState(DEFAULT_INTERVAL);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  useEffect(() => {
    if (!position) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    analytics
      .getCandles(position.symbol, interval, CANDLE_LIMIT)
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

  // Build / rebuild the chart whenever candles arrive. We tear down and
  // recreate on every change rather than mutating in place — the data
  // doesn't change often (open modal, switch interval) and re-creation is
  // simpler than reconciling between intervals.
  useEffect(() => {
    if (!position || !candles || !containerRef.current) return;

    // Tear down any previous chart instance.
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#807678',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(84, 74, 76, 0.15)' },
        horzLines: { color: 'rgba(84, 74, 76, 0.15)' },
      },
      crosshair: {
        mode: 1, // normal crosshair
      },
      rightPriceScale: {
        borderColor: 'rgba(84, 74, 76, 0.4)',
      },
      timeScale: {
        borderColor: 'rgba(84, 74, 76, 0.4)',
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

    // Three horizontal price lines: entry, mark, liquidation.
    series.createPriceLine({
      price: position.entryPrice,
      color: position.side === 'long' ? '#00B481' : '#EF4A3C',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: 'Entry',
    });

    series.createPriceLine({
      price: position.markPrice,
      color: '#FFFEEF',
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

    // Auto-fit the visible range so all three lines + candles are on screen.
    chart.timeScale().fitContent();

    // Resize observer — keeps the chart sized to its container when the
    // modal resizes (e.g. window resize).
    const resize = () => {
      if (containerRef.current && chart) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    const obs = new ResizeObserver(resize);
    obs.observe(containerRef.current);

    return () => {
      obs.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [candles, position]);

  if (!position) return null;

  // Pre-compute distance-to-liq as a percentage so the streamer / viewer
  // can see "this position is 4% from getting wrecked."
  const distanceToLiqPct = position.liquidationPrice > 0 && position.markPrice > 0
    ? Math.abs((position.markPrice - position.liquidationPrice) / position.markPrice) * 100
    : null;

  return (
    <div
      // Backdrop. Clicking outside the panel closes the modal.
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        // Stop propagation so clicks inside the panel don't bubble to the
        // backdrop close handler.
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-5xl max-h-[90vh] bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                position.side === 'long'
                  ? 'bg-bulk-green/15 text-bulk-green'
                  : 'bg-red-500/15 text-red-400'
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
              {position.leverage}× · {formatNumber(position.size, 4)} units
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

        {/* Stat strip — the four numbers a streamer cares about most */}
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
            valueClass="text-red-400"
            sublabel={
              distanceToLiqPct !== null
                ? `${distanceToLiqPct.toFixed(2)}% away`
                : undefined
            }
          />
          <Stat
            label="Unrealized PnL"
            value={`${position.unrealizedPnl >= 0 ? '+' : ''}$${formatNumber(position.unrealizedPnl, 2)}`}
            valueClass={position.unrealizedPnl >= 0 ? 'text-bulk-green' : 'text-red-400'}
          />
        </div>

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
            {error && <span className="text-red-400">{error}</span>}
            {!loading && !error && candles && (
              <span>
                <span className="font-mono">{candles.length}</span> candles
              </span>
            )}
          </div>
        </div>

        {/* Chart container. min-h ensures it's visible even on small screens. */}
        <div className="flex-1 min-h-[420px] p-2">
          <div ref={containerRef} className="w-full h-full" />
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
