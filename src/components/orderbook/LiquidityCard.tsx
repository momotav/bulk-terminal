'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { analytics, cn, formatCompact, impactBps, type ImpactCurve, type OrderbookLevel, type OrderbookSnapshot } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';

// Round-trip cost (buy then sell the same size at once), the way desks quote a
// market's spread "at size": (avg ask fill − avg bid fill) / mid. At $1K it is the
// top-of-book spread; further out it shows how deep the book really is.
const SIZES = [1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

const bp = (n: number | null) => (n === null ? '—' : n < 0.01 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : n.toFixed(1));
const price = (n: number | null | undefined) => (n == null ? '—' : n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(3) : n.toPrecision(4));
const sizeLabel = (n: number) => (n >= 1e6 ? `$${n / 1e6}M` : `$${n / 1e3}K`);

/** Average fill vs mid (bps) for a market order of `usd` walking one side; null if the shown book runs out. */
function walk(levels: OrderbookLevel[], mid: number, usd: number): number | null {
  let left = usd, qty = 0, cost = 0;
  for (const l of levels) {
    const lv = l.px * l.sz;
    const take = Math.min(left, lv);
    qty += take / l.px; cost += take; left -= take;
    if (left <= 1e-9) break;
  }
  if (left > 1e-6 || qty <= 0) return null;
  return Math.abs(cost / qty - mid) / mid * 1e4;
}

export function LiquidityCard({ coin, book, impact }: { coin: string; book: OrderbookSnapshot; impact: ImpactCurve | null }) {
  const sym = coin.replace(/-USD$/, '');
  const s = book.stats;
  const mid = s?.mid ?? null;
  const [mo, setMo] = useState<{ mark: number; oracle: number; bps: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => analytics.getMarkOracle(1).then((d) => {
      const r = d.live.find((x) => x.symbol === coin);
      if (alive) setMo(r ? { mark: r.mark, oracle: r.oracle, bps: r.bps } : null);
    }).catch(() => {});
    load();
    const t = window.setInterval(load, 10_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [coin]);

  // Spread at size: our own walk of the book, topped up by BULK's deep impact curve
  // where the shown levels run out (marked ~).
  const ladder = useMemo(() => SIZES.map((usd) => {
    if (!mid) return { usd, bps: null as number | null, approx: false };
    const buy = walk(book.asks, mid, usd), sell = walk(book.bids, mid, usd);
    if (buy !== null && sell !== null) return { usd, bps: buy + sell, approx: false };
    const ib = buy ?? impactBps(impact?.book?.buy, usd / mid);
    const is = sell ?? impactBps(impact?.book?.sell, usd / mid);
    return { usd, bps: ib !== null && is !== null ? ib + is : null, approx: true };
  }), [book, mid, impact]);
  const maxBp = Math.max(0.5, ...ladder.map((l) => l.bps ?? 0));

  const bid = s?.bidDepth2pctUsd ?? 0, ask = s?.askDepth2pctUsd ?? 0, total = bid + ask;
  const bidShare = total > 0 ? bid / total : 0.5;

  const sizeTxt = (l: OrderbookLevel | null | undefined) => (l ? `${l.sz < 1 ? l.sz.toFixed(4) : l.sz < 100 ? l.sz.toFixed(2) : formatCompact(l.sz)} ${sym}${l.n ? ` · ${l.n} orders` : ''}` : undefined);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-muted)] [background-image:var(--surface-gradient)]">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="flex items-center gap-2.5">
          <CoinIcon symbol={sym} size={26} />
          <div>
            <div className="text-[15px] font-medium leading-tight text-[var(--text-primary)]">{sym}-USD liquidity</div>
            <div className="text-[11px] text-[var(--text-tertiary)]">Spread at size · cost to buy and sell at once</div>
          </div>
        </div>
        <div className="flex items-end gap-6 text-right">
          <div>
            <div className="text-[11px] text-[var(--text-tertiary)]">Spread</div>
            <div className="text-[22px] font-medium leading-tight tabular-nums text-[var(--text-primary)]">{bp(s?.spreadBps ?? null)}<span className="ml-1 text-[12px] text-[var(--text-tertiary)]">bp</span></div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--text-tertiary)]">Mid</div>
            <div className="text-[22px] font-medium leading-tight tabular-nums text-[var(--text-primary)]">{price(mid)}</div>
          </div>
        </div>
      </div>

      {/* the curve */}
      <CostCurve points={ladder} max={maxBp} />

      {/* the book at a glance */}
      <div className="grid grid-cols-2 border-t border-[var(--border-color)] sm:grid-cols-3 lg:grid-cols-5 [&>*]:border-[var(--border-color)] lg:[&>*:not(:last-child)]:border-r">
        <Cell k="Best bid" v={price(s?.bestBid?.px)} color="var(--pos)" sub={sizeTxt(s?.bestBid)} />
        <Cell k="Best ask" v={price(s?.bestAsk?.px)} color="var(--neg)" sub={sizeTxt(s?.bestAsk)} />
        <Cell k="Mark" v={price(mo?.mark)} sub={mo && mid ? `${mo.mark >= mid ? '+' : '−'}${Math.abs((mo.mark / mid - 1) * 1e4).toFixed(2)} bp vs mid` : undefined} />
        <Cell k="Mark vs oracle" v={mo ? `${mo.bps >= 0 ? '+' : '−'}${Math.abs(mo.bps).toFixed(2)} bp` : '—'} sub={mo ? `oracle ${price(mo.oracle)}` : undefined}
          color={mo ? (Math.abs(mo.bps) < 0.5 ? undefined : mo.bps > 0 ? 'var(--pos)' : 'var(--neg)') : undefined} />
        <div className="col-span-2 px-4 py-2.5 sm:col-span-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-[var(--text-tertiary)]">Depth ±2%</span>
            <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">{Math.round(bidShare * 100)}% bids</span>
          </div>
          <div className="mt-0.5 text-[15px] font-medium tabular-nums text-[var(--text-primary)]">{total ? `$${formatCompact(total)}` : '—'}</div>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full">
            <div className="transition-[width] duration-500" style={{ width: `${bidShare * 100}%`, background: 'var(--pos)', opacity: 0.85 }} />
            <div className="w-px" />
            <div className="flex-1" style={{ background: 'var(--neg)', opacity: 0.85 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Spread at size as one smooth cost curve, sizes evenly spaced, every point labelled. */
function CostCurve({ points, max }: { points: { usd: number; bps: number | null; approx: boolean }[]; max: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(900);
  const gid = useId().replace(/:/g, '');
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const H = 190, top = 34, bottom = 30, padX = 36;
  const n = points.length;
  const xs = points.map((_, i) => padX + (i * (w - padX * 2)) / (n - 1));
  const ys = points.map((p) => top + (1 - (p.bps ?? 0) / max) * (H - top - bottom));
  const line = monotonePath(xs, ys);
  const base = H - bottom;
  return (
    <div ref={ref} className="px-1">
      <svg width={w} height={H} className="block overflow-visible" role="img" aria-label="Spread at size">
        <defs>
          <linearGradient id={`${gid}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {xs.map((x, i) => <line key={`g${i}`} x1={x} x2={x} y1={top - 6} y2={base} strokeDasharray="2 5" style={{ stroke: 'var(--border-color)' }} />)}
        <line x1={padX - 12} x2={w - padX + 12} y1={base} y2={base} style={{ stroke: 'var(--border-color)' }} />
        <path d={`${line} L${xs[n - 1]},${base} L${xs[0]},${base} Z`} fill={`url(#${gid}a)`} />
        <path d={line} fill="none" strokeWidth={2.25} strokeLinecap="round" style={{ stroke: 'var(--accent)', transition: 'd 500ms ease' }} />
        {points.map((p, i) => (
          <g key={p.usd}>
            <circle cx={xs[i]} cy={ys[i]} r={4} strokeWidth={2} style={{ fill: 'var(--bg-muted)', stroke: 'var(--accent)' }} />
            <text x={xs[i]} y={ys[i] - 11} textAnchor="middle" fontSize={12} fontWeight={500} style={{ fill: 'var(--text-primary)' }}>{p.approx && p.bps !== null ? '~' : ''}{bp(p.bps)}</text>
            <text x={xs[i]} y={H - 10} textAnchor="middle" fontSize={11} style={{ fill: 'var(--text-tertiary)' }}>{sizeLabel(p.usd)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Monotone cubic path through the points (no overshoot below zero). */
function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n < 2) return '';
  const d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let p = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    p += ` C${xs[i] + dx},${ys[i] + m[i] * dx} ${xs[i + 1] - dx},${ys[i + 1] - m[i + 1] * dx} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return p;
}

function Cell({ k, v, sub, color }: { k: string; v: string; sub?: string; color?: string }) {
  return (
    <div className="border-b border-[var(--border-color)] px-4 py-2.5 lg:border-b-0">
      <div className="text-[11px] text-[var(--text-tertiary)]">{k}</div>
      <div className="mt-0.5 text-[15px] font-medium tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>{v}</div>
      <div className="mt-0.5 h-[14px] truncate text-[10px] tabular-nums text-[var(--text-tertiary)]">{sub ?? ''}</div>
    </div>
  );
}

