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
  type CandlestickData, type UTCTimestamp, type WhitespaceData,
} from 'lightweight-charts';
import { X } from 'lucide-react';
import { analytics, cn, formatCompact, type Candle, type OrderbookSnapshot } from '@/lib/api';
import { type BulkTicker, formatPrice, openInterestUsd } from '@/hooks/useTickers';
import { clampWicks } from '@/lib/candles';

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

export function CoinDetailModal({ ticker, onClose }: { ticker: BulkTicker | null; onClose: () => void }) {
  const [interval, setIntervalValue] = useState('1h');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [book, setBook] = useState<OrderbookSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

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

  // Candles for the selected interval.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    analytics.getCandles(symbol, interval, 300)
      .then((res) => { if (!cancelled) setCandles(res.candles); })
      .catch(() => { if (!cancelled) setCandles([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, interval]);

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

  // Drop BULK's empty no-trade filler candles + clamp bad-print wicks.
  const plotted = useMemo(
    () => clampWicks((candles ?? []).filter((c) => c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0)),
    [candles],
  );

  // Create the chart once per open. Data is pushed by the effect below.
  useEffect(() => {
    const container = wrapRef.current;
    if (!symbol || !container) return;
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
    });
    chartRef.current = chart;
    seriesRef.current = chart.addCandlestickSeries({
      upColor: pos, downColor: neg,
      borderUpColor: pos, borderDownColor: neg,
      wickUpColor: pos, wickDownColor: neg,
    });
    const resize = () => chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    const obs = new ResizeObserver(resize);
    obs.observe(container);
    return () => { obs.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [symbol]);

  // Push candle data whenever it changes.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data: (CandlestickData | WhitespaceData)[] = plotted.map((c) => ({
      time: Math.floor(c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [plotted]);

  if (typeof document === 'undefined' || !symbol || !ticker) return null;

  const up = ticker.priceChangePercent >= 0;
  const changeColor = up ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full max-h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--role-line)] bg-[var(--role-surface)] shadow-2xl lg:flex-row"
      >
        {/* ---- Left: header stats + candlestick chart ---- */}
        <div className="flex min-h-0 flex-1 flex-col border-b border-[var(--role-line-subtle)] lg:border-b-0 lg:border-r">
          {/* Header stats */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--role-line-subtle)] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-[var(--role-content)]">{coinOf(symbol)}</span>
              <span className="text-[11px] text-[var(--role-content-subtle)]">{symbol}</span>
            </div>
            <Stat label="Mark Price" value={usd(ticker.markPrice || ticker.lastPrice)} />
            <Stat label="24H Change" value={`${up ? '+' : ''}${ticker.priceChangePercent.toFixed(2)}%`} color={changeColor} />
            <Stat label="24H Volume" value={usd(ticker.quoteVolume)} />
            <Stat label="Open Interest" value={usd(openInterestUsd(ticker))} />
            <button
              onClick={onClose}
              aria-label="Close"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-[var(--role-content-subtle)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--role-content)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Interval toggles */}
          <div className="flex items-center gap-1 px-4 py-2 sm:px-5">
            {INTERVALS.map((it) => (
              <button
                key={it.value}
                onClick={() => setIntervalValue(it.value)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  interval === it.value
                    ? 'bg-[var(--bg-secondary-20)] text-[var(--role-content)]'
                    : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]',
                )}
              >
                {it.label}
              </button>
            ))}
          </div>

          {/* Chart */}
          <div className="relative min-h-0 flex-1 px-2 pb-2">
            <div ref={wrapRef} className="h-full w-full" />
            {loading && plotted.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--role-content-subtle)]">Loading chart…</div>
            )}
            {!loading && plotted.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--role-content-subtle)]">No candle data.</div>
            )}
          </div>
        </div>

        {/* ---- Right: order book ---- */}
        <div className="flex min-h-0 w-full flex-col lg:w-[380px] xl:w-[420px]">
          <OrderBook book={book} />
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

// Compact order book: spread strip, bid/ask imbalance bar, then coupled ladders.
function OrderBook({ book }: { book: OrderbookSnapshot | null }) {
  const levels = 16;
  const bids = (book?.bids ?? []).slice(0, levels);
  const asks = (book?.asks ?? []).slice(0, levels);
  const maxSz = Math.max(1e-9, ...bids.map((l) => l.sz), ...asks.map((l) => l.sz));
  const stats = book?.stats;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--role-line-subtle)] px-4 py-3">
        <h3 className="text-base font-bold text-[var(--role-content)]">Order Book</h3>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--role-content-subtle)]">
          <span className={cn('h-1.5 w-1.5 rounded-full', book?.stale ? 'bg-[var(--role-signal-negative)]' : 'bg-[var(--role-signal-positive)]')} />
          {book?.stale ? 'STALE' : 'LIVE'}
        </span>
      </div>

      {/* Spread + mid */}
      <div className="flex items-center justify-center gap-2.5 border-b border-[var(--role-line-subtle)] bg-[var(--role-background)]/40 py-2 text-[11px] tabular-nums">
        <span className="text-[var(--role-content-subtle)]">Spread</span>
        <span className="font-semibold text-[var(--role-content)]">{stats?.spreadBps != null ? `${stats.spreadBps.toFixed(2)} bps` : '—'}</span>
        <span className="text-[var(--role-line)]">·</span>
        <span className="text-[var(--role-content-subtle)]">Mid</span>
        <span className="font-semibold text-[var(--role-content)]">{stats?.mid != null ? `$${formatPrice(stats.mid)}` : '—'}</span>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-2 gap-3 px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-[var(--role-content-subtle)]">
        <div className="flex justify-between"><span>Price</span><span>Size</span></div>
        <div className="flex justify-between"><span>Price</span><span>Size</span></div>
      </div>

      {/* Ladders */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {!book ? (
          <div className="flex h-full items-center justify-center py-10 text-[11px] text-[var(--role-content-subtle)]">Loading book…</div>
        ) : (
          <div className="grid grid-cols-2">
            <Ladder rows={bids} maxSz={maxSz} side="bid" />
            <Ladder rows={asks} maxSz={maxSz} side="ask" />
          </div>
        )}
      </div>

      {book?.timestamp ? (
        <div className="border-t border-[var(--role-line-subtle)] py-1.5 text-center text-[10px] text-[var(--role-content-subtle)]">
          Last update: {new Date(book.timestamp).toLocaleTimeString()}
        </div>
      ) : null}
    </div>
  );
}

function Ladder({ rows, maxSz, side }: { rows: { px: number; sz: number }[]; maxSz: number; side: 'bid' | 'ask' }) {
  const pxColor = side === 'bid' ? 'var(--role-signal-positive)' : 'var(--role-signal-negative)';
  const fill = side === 'bid' ? 'rgb(var(--pos-rgb) / 0.14)' : 'rgb(var(--neg-rgb) / 0.14)';
  return (
    <div className={side === 'ask' ? 'border-l border-[var(--role-line-subtle)]' : ''}>
      {rows.map((l, i) => {
        const pct = (l.sz / maxSz) * 100;
        return (
          <div key={`${side}-${i}`} className="relative grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-[3px] text-[11px] tabular-nums">
            <div
              className={cn('pointer-events-none absolute inset-y-px', side === 'bid' ? 'right-0' : 'left-0')}
              style={{ width: `${pct}%`, background: fill }}
            />
            <span className="relative font-medium" style={{ color: pxColor }}>${formatPrice(l.px)}</span>
            <span className="relative text-right text-[var(--role-content)]">{l.sz.toFixed(4)}</span>
          </div>
        );
      })}
      {rows.length === 0 && <div className="py-6 text-center text-[11px] text-[var(--role-content-subtle)]">No levels</div>}
    </div>
  );
}
