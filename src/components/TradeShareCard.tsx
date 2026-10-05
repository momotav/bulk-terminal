'use client';

// ---------------------------------------------------------------------------
// TradeShareCard
//
// A compact, screenshot-ready "share this trade" card in the fomo style —
// a few candles leading into the trade, running to the last candle (open) or
// the close bar (closed), with a status-aware headline PnL:
//   - open   → LIVE unrealized PnL (streams a mark price, the last candle and
//              the number tick in real time)
//   - closed → fixed realized PnL
// plus an Invested / Avg entry / Current stat row. Styled in the BULK palette,
// layout mirrored from the fomo card. Opened from the observe page.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { analytics, marketStreamUrl, formatNumber, formatCompact, formatAddress, type Candle } from '@/lib/api';
import { getCoinColor } from '@/lib/coins';

export interface ShareCardData {
  address: string;
  symbol: string;        // "BTC-USD"
  coin: string;          // "BTC"
  side: 'long' | 'short';
  isOpen: boolean;
  openedAt: number;      // ms
  closedAt: number | null;
  avgEntry: number;
  size: number;          // absolute (peak) size
  leverage: number;      // 0 if unknown
  markPrice: number | null;  // initial mark (open)
  exitPrice: number | null;  // final price (closed)
  /** life.finalPnl — used as the open fallback until the first live tick, and
   *  as the realized number for closed trades. */
  pnl: number;
}

interface Props {
  data: ShareCardData;
  onClose: () => void;
}

// Pick an interval so the trade + a lead-in renders as ~40 candles.
const IV_SECONDS: [string, number][] = [['1m', 60], ['5m', 300], ['15m', 900], ['1h', 3600], ['4h', 14400], ['1d', 86400]];
function pickCardInterval(spanMs: number): [string, number] {
  const target = spanMs / 1000 / 40;
  let best = IV_SECONDS[IV_SECONDS.length - 1];
  for (const iv of IV_SECONDS) { if (iv[1] >= target) { best = iv; break; } }
  return best;
}

// Deterministic gradient avatar from the wallet address.
function avatarGradient(addr: string): { bg: string; initials: string } {
  let h = 7;
  for (const c of addr) h = (h * 31 + c.charCodeAt(0)) | 0;
  const h1 = Math.abs(h) % 360;
  const h2 = (h1 + 48) % 360;
  return {
    bg: `linear-gradient(135deg, hsl(${h1} 65% 55%), hsl(${h2} 70% 42%))`,
    initials: addr.replace(/^0x/, '').slice(0, 2).toUpperCase(),
  };
}

export function TradeShareCard({ data, onClose }: Props) {
  const { address, symbol, coin, side, isOpen, openedAt, closedAt, avgEntry, size, leverage } = data;
  const signedSize = side === 'long' ? size : -size;
  const notional = size * avgEntry;
  const margin = leverage > 0 ? notional / leverage : notional;

  const [candles, setCandles] = useState<Candle[] | null>(null);
  // Live mark for OPEN trades (streamed). Seeded with the snapshot mark.
  const [liveMark, setLiveMark] = useState<number | null>(isOpen ? data.markPrice : null);
  const latestRef = useRef<number | null>(null);

  // Focused candle window: a lead-in before the entry → last candle (open) or
  // the close (closed), sized to ~40 bars.
  useEffect(() => {
    let cancelled = false;
    const end = isOpen ? Date.now() : (closedAt ?? openedAt + 3_600_000);
    const tradeSpan = Math.max(end - openedAt, 30 * 60_000);
    const lead = Math.max(tradeSpan * 0.5, 20 * 60_000);
    const start = openedAt - lead;
    const [iv, sec] = pickCardInterval(end - start);
    const bar = sec * 1000;
    analytics
      .getCandles(symbol, iv, 500, { startTime: start - bar, endTime: end + bar * 2 })
      .then((res) => { if (!cancelled) setCandles(res.candles); })
      .catch(() => { if (!cancelled) setCandles([]); });
    return () => { cancelled = true; };
  }, [symbol, isOpen, openedAt, closedAt]);

  // Live price stream for open positions — drives the ticking PnL + last candle.
  useEffect(() => {
    if (!isOpen) return;
    const es = new EventSource(marketStreamUrl(symbol));
    es.onmessage = (ev) => {
      let msg: { price: number; kind: string };
      try { msg = JSON.parse(ev.data); } catch { return; }
      const p = Number(msg.price);
      if (p > 0) latestRef.current = p;
    };
    es.onerror = () => { /* EventSource auto-reconnects */ };
    const flush = window.setInterval(() => {
      const m = latestRef.current;
      if (m != null) setLiveMark((prev) => (prev === m ? prev : m));
    }, 400);
    return () => { es.close(); window.clearInterval(flush); };
  }, [isOpen, symbol]);

  // Current price + PnL, status-aware.
  const currentPrice = isOpen ? (liveMark ?? data.markPrice ?? avgEntry) : (data.exitPrice ?? avgEntry);
  const pnl = isOpen ? signedSize * (currentPrice - avgEntry) : data.pnl;
  const pnlPct = margin > 0 ? (pnl / margin) * 100 : 0;
  const positive = pnl >= 0;
  const posColor = 'var(--pos)';
  const negColor = 'var(--neg)';
  const tone = positive ? posColor : negColor;

  // For open trades, let the last candle reflect the live price so the chart
  // "breathes" with the number.
  const displayCandles = useMemo(() => {
    const cs = (candles ?? []).filter((c) => c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0);
    if (!isOpen || cs.length === 0 || liveMark == null) return cs;
    const last = { ...cs[cs.length - 1] };
    last.c = liveMark;
    last.h = Math.max(last.h, liveMark);
    last.l = Math.min(last.l, liveMark);
    return [...cs.slice(0, -1), last];
  }, [candles, isOpen, liveMark]);

  const avatar = avatarGradient(address);
  const dateStr = new Date(isOpen ? Date.now() : (closedAt ?? openedAt)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const coinColor = getCoinColor(coin);
  const px = (p: number) => `$${formatNumber(p, p < 10 ? 4 : p < 1000 ? 2 : 0)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-[420px]">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-3 -right-3 z-10 rounded-full bg-[var(--bg-muted)] border border-[var(--border-color)] p-1.5 text-[var(--text-secondary)] shadow-lg transition-colors hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Accent frame → card, mirroring the fomo bordered look. */}
        <div className="rounded-[22px] p-[3px]" style={{ background: 'linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent) 35%, transparent))' }}>
          <div className="overflow-hidden rounded-[19px] bg-[var(--bg-base)]">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5">
              <div
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ background: avatar.bg }}
              >
                {avatar.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold text-[var(--text-primary)]" title={address}>
                  {formatAddress(address)}
                </div>
                <span
                  className="mt-0.5 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{
                    color: isOpen ? 'var(--accent-text)' : 'var(--role-content-subtle)',
                    background: isOpen ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--bg-secondary-20)',
                  }}
                >
                  {isOpen ? 'Open' : 'Closed'}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-[var(--text-tertiary)]">{dateStr}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/chartlogo.png" alt="bulkstats" className="h-5 w-auto select-none opacity-80" />
              </div>
            </div>

            {/* Mini candle chart with the current-price dotted line + pill. */}
            <div className="mt-4 px-2">
              <MiniCandles candles={displayCandles} currentPrice={currentPrice} tone={tone} priceLabel={px(currentPrice)} />
            </div>

            {/* Body card */}
            <div className="m-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-5">
              {/* Coin row */}
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: coinColor }}>
                  {coin.slice(0, 1)}
                </span>
                <span className="text-lg font-medium text-[var(--text-primary)]">{coin}</span>
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: side === 'long' ? posColor : negColor, background: side === 'long' ? 'color-mix(in srgb, var(--pos) 15%, transparent)' : 'color-mix(in srgb, var(--neg) 15%, transparent)' }}
                >
                  {side}{leverage > 0 ? ` ${leverage}×` : ''}
                </span>
              </div>

              {/* Headline PnL */}
              <div className="mt-4 flex items-baseline gap-2.5">
                <span className="text-[34px] font-semibold leading-none tabular-nums" style={{ color: tone }}>
                  {positive ? '+' : '−'}${formatNumber(Math.abs(pnl), 2)}
                </span>
                <span className="text-lg font-medium tabular-nums" style={{ color: tone }}>
                  {positive ? '▲' : '▼'} {Math.abs(pnlPct).toFixed(2)}%
                </span>
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                {isOpen ? 'Unrealized PnL' : 'Realized PnL'}
              </div>

              {/* Stats */}
              <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-xl border border-[var(--border-color)]">
                <CardStat label="Invested" value={`$${formatCompact(margin)}`} />
                <CardStat label="Avg. entry" value={px(avgEntry)} border />
                <CardStat label={isOpen ? 'Current' : 'Exit'} value={px(currentPrice)} border />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 pb-4 pt-1">
              <span className="text-base font-semibold lowercase text-[var(--text-primary)]">bulkstats</span>
              <span className="text-[11px] text-[var(--text-tertiary)]">observe on bulkstats.com</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CardStat({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`px-3 py-3 ${border ? 'border-l border-[var(--border-color)]' : ''}`}>
      <div className="text-[11px] text-[var(--text-tertiary)]">{label}</div>
      <div className="mt-1 text-base font-medium tabular-nums text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

// Compact SVG candlestick chart: wicks + bodies, with a dotted horizontal line
// at the current price carrying a colored pill on the right edge.
function MiniCandles({ candles, currentPrice, tone, priceLabel }: { candles: Candle[]; currentPrice: number; tone: string; priceLabel: string }) {
  const W = 400, H = 150, padR = 64, padT = 10, padB = 22;
  if (candles.length < 2) {
    return <div className="h-[150px] w-full" />;
  }
  const n = candles.length;
  const plotW = W - padR;
  const lo = Math.min(...candles.map((c) => c.l), currentPrice);
  const hi = Math.max(...candles.map((c) => c.h), currentPrice);
  const range = hi - lo || 1;
  const y = (p: number) => padT + (1 - (p - lo) / range) * (H - padT - padB);
  const step = plotW / n;
  const bodyW = Math.max(2, Math.min(10, step * 0.6));
  const pos = 'var(--pos)', neg = 'var(--neg)';
  const cy = y(currentPrice);

  // Time labels — first and middle candle.
  const fmtT = (t: number) => new Date(t).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" preserveAspectRatio="none">
      {candles.map((c, i) => {
        const cx = i * step + step / 2;
        const up = c.c >= c.o;
        const col = up ? pos : neg;
        const yO = y(c.o), yC = y(c.c);
        const top = Math.min(yO, yC);
        const hgt = Math.max(1, Math.abs(yC - yO));
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1} />
            <rect x={cx - bodyW / 2} y={top} width={bodyW} height={hgt} fill={col} />
          </g>
        );
      })}
      {/* current-price dotted line + pill */}
      <line x1={0} x2={plotW} y1={cy} y2={cy} stroke={tone} strokeWidth={1} strokeDasharray="2 3" opacity={0.9} />
      <rect x={plotW + 2} y={cy - 11} width={padR - 4} height={22} rx={6} fill={tone} />
      <text x={plotW + padR / 2} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff">
        {priceLabel}
      </text>
      {/* sparse x-axis time labels */}
      <text x={step / 2} y={H - 6} fontSize={10} fill="var(--text-tertiary)">{fmtT(candles[0].t)}</text>
      <text x={plotW / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--text-tertiary)">
        {fmtT(candles[Math.floor(n / 2)].t)}
      </text>
    </svg>
  );
}
