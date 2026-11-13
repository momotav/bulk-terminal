'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn, formatNumber } from '@/lib/api';
import { useLivePrice, useOrderbook } from './live';
import { price } from './parts';

// A market's order book for the workspace: asks over bids around the live price,
// depth bars by cumulative size, as many levels as the window has room for.
// Used attached to a chart (inside its window) or floating on its own.

const ROW = 19;
const usd = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : formatNumber(n, 0));

export function BookView({ coin, actions, className }: { coin: string; actions?: ReactNode; className?: string }) {
  const book = useOrderbook(coin);
  const tick = useLivePrice(coin, 200);
  const prev = useRef<number | null>(null);
  const [up, setUp] = useState(true);
  const body = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState(10);

  // The book's own mid (best bid and ask) at the centre, so it always sits between
  // the two sides. The stream's mark price moves smoothly and can trail the book.
  const bestAsk = book?.asks?.[0]?.px; const bestBid = book?.bids?.[0]?.px;
  const mid = book?.stats?.mid ?? (bestAsk && bestBid ? (bestAsk + bestBid) / 2 : null);
  useEffect(() => {
    if (mid === null) return;
    if (prev.current !== null && mid !== prev.current) setUp(mid > prev.current);
    prev.current = mid;
  }, [mid]);

  // Levels per side from the height available, so a tall window shows a deeper book.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const fit = () => setRows(Math.max(3, Math.min(20, Math.floor((el.clientHeight - 34) / 2 / ROW))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const side = (levels: { px: number; sz: number }[] | undefined) => {
    let sum = 0;
    return (levels ?? []).slice(0, rows).map((l) => { const v = l.px * l.sz; sum += v; return { px: l.px, v, sum }; });
  };
  const asks = side(book?.asks);
  const bids = side(book?.bids);
  const maxSum = Math.max(asks[asks.length - 1]?.sum ?? 0, bids[bids.length - 1]?.sum ?? 0, 1);
  const spread = bestAsk && bestBid ? bestAsk - bestBid : null;
  const spreadBps = spread !== null && mid ? (spread / mid) * 1e4 : null;
  const bpsTxt = spreadBps === null ? null : spreadBps >= 1 ? spreadBps.toFixed(2) : spreadBps >= 0.01 ? spreadBps.toFixed(3) : 'under 0.01';
  const bidShare = (() => {
    const b = bids[bids.length - 1]?.sum ?? 0; const a = asks[asks.length - 1]?.sum ?? 0;
    return a + b > 0 ? b / (a + b) : 0.5;
  })();

  return (
    <div className={cn('flex flex-col h-full min-h-0 text-[11px] tabular-nums', className)}>
      <div className="flex items-center gap-2 h-9 px-3 shrink-0 border-b border-[var(--border-color)]">
        <span className="text-[12px] font-medium text-[var(--text-primary)] whitespace-nowrap">Order book</span>
        {book?.stale && <span className="text-[11px] text-[var(--text-tertiary)]" title="BULK's live book is briefly unavailable; showing the last good one">delayed</span>}
        <div className="flex-1" />
        {actions}
      </div>
      <div className="grid grid-cols-3 gap-2 px-3 h-6 items-center shrink-0 text-[10px] text-[var(--text-tertiary)]">
        <span>Price</span><span className="text-right">Size</span><span className="text-right">Total</span>
      </div>
      <div ref={body} className="relative flex-1 min-h-0 flex flex-col">
        {!book ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-tertiary)]">Loading book…</div>
        ) : (
          <>
            <div className="flex-1 flex flex-col justify-end min-h-0 overflow-hidden">
              {[...asks].reverse().map((r) => <Level key={`a${r.px}`} r={r} max={maxSum} ask />)}
            </div>
            <div className="flex items-center justify-between gap-2 px-3 h-[34px] shrink-0 border-y border-[var(--border-color)]">
              <span className="flex flex-col leading-tight">
                <span className="text-[14px] font-medium transition-colors" style={{ color: up ? 'var(--pos)' : 'var(--neg)' }} title="Mid: halfway between the best bid and ask">{mid ? price(mid) : '—'}</span>
                {tick && <span className="text-[9px] text-[var(--text-tertiary)]" title="BULK's mark price, what positions are valued at">Mark {price(tick.price)}</span>}
              </span>
              <span className="flex flex-col items-end gap-0.5 text-[10px] text-[var(--text-tertiary)]">
                <span className="flex items-center gap-1.5" title="Share of the shown depth on each side">
                  <span style={{ color: 'var(--pos)' }}>{Math.round(bidShare * 100)}%</span>
                  <span className="relative w-10 h-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--neg-rgb) / 0.55)' }}>
                    <span className="absolute inset-y-0 left-0 transition-[width] duration-500" style={{ width: `${bidShare * 100}%`, background: 'rgb(var(--pos-rgb) / 0.8)' }} />
                  </span>
                  <span style={{ color: 'var(--neg)' }}>{100 - Math.round(bidShare * 100)}%</span>
                </span>
                {spread !== null && <span className="text-[9px] whitespace-nowrap" title="Gap between the best ask and the best bid">Spread ${spread >= 1 ? price(spread) : spread.toFixed(spread < 0.0095 ? 4 : 2)} · {bpsTxt} bps</span>}
              </span>
            </div>
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {bids.map((r) => <Level key={`b${r.px}`} r={r} max={maxSum} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Level({ r, max, ask }: { r: { px: number; v: number; sum: number }; max: number; ask?: boolean }) {
  const rgb = ask ? 'var(--neg-rgb)' : 'var(--pos-rgb)';
  return (
    <div className="relative grid grid-cols-3 gap-2 px-3 items-center shrink-0" style={{ height: ROW }}>
      <div className="pointer-events-none absolute inset-y-px right-0 transition-[width] duration-500 ease-out" style={{ width: `${(r.sum / max) * 100}%`, background: `rgb(${rgb} / 0.14)` }} />
      <span className="relative" style={{ color: ask ? 'var(--neg)' : 'var(--pos)' }}>{price(r.px)}</span>
      <span className="relative text-right text-[var(--text-primary)]">{usd(r.v)}</span>
      <span className="relative text-right text-[var(--text-secondary)]">{usd(r.sum)}</span>
    </div>
  );
}
