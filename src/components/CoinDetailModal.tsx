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
import { analytics, cn, formatCompact, formatAddress, type Candle, type OrderbookSnapshot, type MarketTrade, type MarketLiquidation } from '@/lib/api';
import { type BulkTicker, openInterestUsd } from '@/hooks/useTickers';
import { clampWicks } from '@/lib/candles';
import { CoinIcon } from '@/components/CoinIcon';

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
  // Only treat a click as "backdrop click to close" when BOTH the press and the
  // release land on the backdrop itself — so a drag that starts inside the
  // panel (e.g. panning the chart) and ends outside never closes the modal.
  const backdropDown = useRef(false);

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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-3 backdrop-blur-md sm:p-6"
      onMouseDown={(e) => { backdropDown.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => { if (backdropDown.current && e.target === e.currentTarget) onClose(); backdropDown.current = false; }}
    >
      <div className="flex h-full max-h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--role-line)] bg-[var(--role-surface)] shadow-2xl">
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <div className="flex flex-col lg:flex-row lg:items-stretch">
            {/* ---- Left: header stats + candlestick chart ---- */}
            <div className="flex min-h-0 flex-1 flex-col border-b border-[var(--role-line-subtle)] lg:border-b-0 lg:border-r">
          {/* Header stats */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--role-line-subtle)] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <CoinIcon symbol={symbol} size={26} />
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

          {/* Chart — grows to match the order-book column's full height. */}
          <div className="relative min-h-[360px] flex-1 px-2 pb-2 lg:min-h-0">
            <div ref={wrapRef} className="h-full w-full" />
            {loading && plotted.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--role-content-subtle)]">Loading chart…</div>
            )}
            {!loading && plotted.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--role-content-subtle)]">No candle data.</div>
            )}
          </div>
        </div>

            {/* ---- Right: order book + Trade button ---- */}
            <div className="flex w-full flex-col border-b border-[var(--role-line-subtle)] lg:w-[380px] lg:border-b-0 xl:w-[440px]">
              <OrderBook book={book} mark={ticker.markPrice || ticker.lastPrice} last={ticker.lastPrice} up={up} />
              {/* Trade CTA under the book. The chart column stretches to this
                  column's height, so chart height = order book + this button. */}
              <div className="p-3">
                <a
                  href={`https://app.bulk.trade/trade/${symbol}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center rounded-xl px-4 py-3.5 text-sm font-bold text-white transition-[filter] hover:brightness-110"
                  style={{
                    background: 'linear-gradient(135deg, #8f8582 0%, #6b615e 48%, #443c39 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(0,0,0,0.28), 0 1px 2px rgba(0,0,0,0.35)',
                  }}
                >
                  Trade {coinOf(symbol)}
                </a>
              </div>
            </div>
          </div>

          {/* ---- Bottom feeds ---- */}
          <RecentTrades symbol={symbol} up={up} />
          <LiquidationFeed symbol={symbol} />
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
const fmtPx = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const mid = book?.stats?.mid ?? last ?? mark;
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
              <span className="text-[11px] tabular-nums text-[var(--role-content-subtle)]">${fmtPx(mark)}</span>
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
          <span className="absolute inset-y-0 left-0" style={{ width: `${bidPct}%`, background: 'var(--role-signal-positive)' }} />
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
      <div className="pointer-events-none absolute inset-y-0 right-0" style={{ width: `${pct}%`, background: grad }} />
      <span className="relative font-medium" style={{ color: pxColor }}>{fmtPx(row.px)}</span>
      <span className="relative text-right text-[var(--role-content)]">{fmtUsdShort(row.usd)}</span>
      <span className="relative text-right text-[var(--role-content)]">{fmtUsdShort(row.sum)}</span>
    </div>
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
function RecentTrades({ symbol, up }: { symbol: string; up: boolean }) {
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
  const vwap = szSum > 0 ? rows.reduce((s, t) => s + t.price * t.size, 0) / szSum : 0;
  const lastPx = rows[0]?.price ?? 0;
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
              return (
                <tr key={i} className="border-t border-[var(--role-line-subtle)]">
                  <td className="py-1.5 pr-3 text-[var(--role-content-subtle)]">{new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false })}</td>
                  <td className="py-1.5 pr-3"><span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ color: col, borderColor: col }}>{buy ? 'BUY' : 'SELL'}</span></td>
                  <td className="py-1.5 pr-3 text-right font-medium" style={{ color: col }}>${fmtPx(t.price)}</td>
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
function LiquidationFeed({ symbol }: { symbol: string }) {
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
              return (
                <tr key={i} className="border-t border-[var(--role-line-subtle)]">
                  <td className="py-1.5 pr-3 text-[var(--role-content-subtle)]">{l.wallet ? formatAddress(l.wallet) : '—'}</td>
                  <td className="py-1.5 pr-3"><span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ color: col, borderColor: col }}>{long ? 'LONG LIQ' : 'SHORT LIQ'}</span></td>
                  <td className="py-1.5 pr-3 text-right text-[var(--role-content)]">${fmtUsdShort(l.value)}</td>
                  <td className="py-1.5 pr-3 text-right text-[var(--role-content)]">${fmtPx(l.price)}</td>
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
