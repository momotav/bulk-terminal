'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { analytics, cn, formatCompact, type FlowKind, type FlowPoint, type FlowRow } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';
import { InfoTip } from '@/components/InfoTip';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { DivergingBar } from '@/components/charts/DivergingBar';
import { useAssetClass } from '@/hooks/useAssetClass';
import { AssetClassToggle } from '@/components/AssetClassToggle';

const WINDOWS = [[4, '4H'], [24, '24H'], [168, '7D'], [720, '30D']] as const;
const usd = (n: number) => `${n < 0 ? '−' : ''}$${formatCompact(Math.abs(n))}`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}$${formatCompact(Math.abs(n))}`;
// Above +500% open interest the market was listed inside the window; a % says nothing there.
const NEW_OI = 5;
const pct = (n: number | null, d = 1) => (n === null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(d)}%`);
const oiPct = (n: number | null, d = 1) => (n !== null && n >= NEW_OI ? 'new' : pct(n, d));
/** Axis tick: whole % when large, one decimal when small. */
const tickPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100) >= 10 ? Math.abs(n * 100).toFixed(0) : Math.abs(n * 100).toFixed(1)}%`;
const coinOf = (s: string) => s.replace(/-USD$/, '');

const KINDS: Record<FlowKind, { label: string; hint: string; tone: string }> = {
  new_longs: { label: 'New longs', hint: 'Price up, open interest up', tone: 'var(--pos)' },
  short_covering: { label: 'Short covering', hint: 'Price up, open interest down', tone: 'var(--pos)' },
  new_shorts: { label: 'New shorts', hint: 'Price down, open interest up', tone: 'var(--neg)' },
  longs_closing: { label: 'Longs closing', hint: 'Price down, open interest down', tone: 'var(--neg)' },
  quiet: { label: 'Quiet', hint: 'Price and open interest barely moved', tone: 'var(--text-tertiary)' },
};

function Kind({ k }: { k: FlowKind | null }) {
  if (!k) return <span className="text-[var(--text-tertiary)]">—</span>;
  return <span className="whitespace-nowrap text-[12px]" style={{ color: KINDS[k].tone }}>{KINDS[k].label}</span>;
}

/** Price change (x) vs open-interest change (y): each market lands in its flow quadrant. */
function FlowMap({ rows, sel, onPick }: { rows: FlowRow[]; sel: string | null; onPick: (s: string) => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(600);
  const [H, setH] = useState(300);
  const [hover, setHover] = useState<FlowRow | null>(null);
  // Fills whatever height its card gets (the grid row matches the market card next to it).
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { setW(el.clientWidth); setH(Math.max(300, el.clientHeight)); });
    ro.observe(el); setW(el.clientWidth); setH(Math.max(300, el.clientHeight));
    return () => ro.disconnect();
  }, []);
  const pad = 18, inset = 34;
  const pts = rows.filter((r) => r.priceChg !== null && r.oiChg !== null);
  // Symmetric scales around zero; the 90th percentile sets the edge so one outlier doesn't squash the rest (outliers pin to the edge).
  const edge = (vals: number[], floor: number) => {
    const a = vals.map(Math.abs).sort((x, y) => x - y);
    return Math.max(floor, (a[Math.floor(a.length * 0.85)] ?? a[a.length - 1] ?? floor) * 1.3);
  };
  // Newly listed markets (OI from ~0) would stretch the axis and squash everyone else; they pin to the edge instead.
  const ex = edge(pts.map((r) => r.priceChg!), 0.005), ey = edge(pts.filter((r) => r.oiChg! < NEW_OI).map((r) => r.oiChg!), 0.01);
  // Points keep `inset` from the edges so the corner labels stay readable.
  const X = (v: number) => inset + ((Math.max(-ex, Math.min(ex, v)) + ex) / (2 * ex)) * (w - 2 * inset);
  const Y = (v: number) => inset + (1 - (Math.max(-ey, Math.min(ey, v)) + ey) / (2 * ey)) * (H - 2 * inset);
  const corner = 'pointer-events-none absolute text-[11px]';
  return (
    <div ref={box} className="relative min-h-[300px] flex-1 select-none overflow-hidden rounded-xl bg-[var(--bg-base)]" onMouseLeave={() => setHover(null)}>
      {/* Quadrant washes: right half (price up) green, left half red, very faint. */}
      <svg width={w} height={H} className="absolute inset-0">
        <rect x={X(0)} y={0} width={Math.max(0, w - X(0))} height={Y(0)} style={{ fill: 'var(--pos)', opacity: 0.06 }} />
        <rect x={X(0)} y={Y(0)} width={Math.max(0, w - X(0))} height={Math.max(0, H - Y(0))} style={{ fill: 'var(--pos)', opacity: 0.03 }} />
        <rect x={0} y={0} width={X(0)} height={Y(0)} style={{ fill: 'var(--neg)', opacity: 0.06 }} />
        <rect x={0} y={Y(0)} width={X(0)} height={Math.max(0, H - Y(0))} style={{ fill: 'var(--neg)', opacity: 0.03 }} />
        {[-1, -0.5, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={X(f * ex)} x2={X(f * ex)} y1={0} y2={H} strokeDasharray="2 5" style={{ stroke: 'var(--border-color)' }} />
            <line x1={0} x2={w} y1={Y(f * ey)} y2={Y(f * ey)} strokeDasharray="2 5" style={{ stroke: 'var(--border-color)' }} />
            <text x={X(f * ex)} y={Y(0) + 14} fontSize={9} textAnchor="middle" style={{ fill: 'var(--text-tertiary)' }}>{tickPct(f * ex)}</text>
            <text x={X(0) - 6} y={Y(f * ey) + 3} fontSize={9} textAnchor="end" style={{ fill: 'var(--text-tertiary)' }}>{tickPct(f * ey)}</text>
          </g>
        ))}
        <line x1={X(0)} x2={X(0)} y1={0} y2={H} style={{ stroke: 'var(--text-tertiary)', opacity: 0.5 }} />
        <line x1={0} x2={w} y1={Y(0)} y2={Y(0)} style={{ stroke: 'var(--text-tertiary)', opacity: 0.5 }} />
      </svg>
      <div className="pointer-events-none absolute inset-0" aria-hidden style={{ backgroundColor: 'var(--text-primary)', opacity: 0.05, WebkitMaskImage: 'url(/chartlogo.png)', maskImage: 'url(/chartlogo.png)', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center', WebkitMaskSize: `${Math.min(260, w / 3)}px`, maskSize: `${Math.min(260, w / 3)}px` }} />
      <span className={cn(corner, 'right-3 top-2.5')} style={{ color: 'var(--pos)' }}>New longs ↗</span>
      <span className={cn(corner, 'bottom-2.5 right-3')} style={{ color: 'var(--pos)' }}>Short covering ↘</span>
      <span className={cn(corner, 'left-3 top-2.5')} style={{ color: 'var(--neg)' }}>↖ New shorts</span>
      <span className={cn(corner, 'bottom-2.5 left-3')} style={{ color: 'var(--neg)' }}>↙ Longs closing</span>
      <span className="pointer-events-none absolute text-[10px] text-[var(--text-tertiary)]" style={{ left: X(0) + 4, top: pad - 2 }}>OI ↑</span>
      <span className="pointer-events-none absolute text-[10px] text-[var(--text-tertiary)]" style={{ right: pad, top: Y(0) - 16 }}>price →</span>
      {pts.map((r) => (
        <button key={r.symbol} type="button" onClick={() => onPick(r.symbol)} onMouseEnter={() => setHover(r)}
          className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left,top,transform] duration-700 ease-out hover:scale-125',
            sel === r.symbol && 'ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-muted)]')}
          style={{ left: X(r.priceChg!), top: Y(r.oiChg!) }} aria-label={coinOf(r.symbol)}>
          <CoinIcon symbol={coinOf(r.symbol)} size={22} />
        </button>
      ))}
      {hover && (
        <div className="liq-tip pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-[12px]"
          style={{ left: Math.min(Math.max(0, X(hover.priceChg!) + 16), w - 200), top: Math.min(Math.max(0, Y(hover.oiChg!) - 20), H - 96), width: 190 }}>
          <div className="mb-1 flex items-center justify-between"><span className="font-medium text-[var(--text-primary)]">{coinOf(hover.symbol)}</span><Kind k={hover.kind} /></div>
          <div className="flex justify-between text-[var(--text-secondary)]"><span>Price</span><span className="tabular-nums text-[var(--text-primary)]">{pct(hover.priceChg, 2)}</span></div>
          <div className="flex justify-between text-[var(--text-secondary)]"><span>Open interest</span><span className="tabular-nums text-[var(--text-primary)]">{oiPct(hover.oiChg)}{hover.oiDeltaUsd !== null ? ` · ${signed(hover.oiDeltaUsd)}` : ''}</span></div>
          <div className="flex justify-between text-[var(--text-secondary)]"><span>Net taker</span><span className="tabular-nums text-[var(--text-primary)]">{signed(hover.buyUsd - hover.sellUsd)}</span></div>
        </div>
      )}
    </div>
  );
}

/** Net taker flow per hour: buy-heavy hours up in green, sell-heavy down in red. */
function NetBars({ pts }: { pts: FlowPoint[] }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, []);
  const H = 120, padR = 56;
  const max = Math.max(1, ...pts.map((p) => Math.abs(p.net)));
  const bw = Math.max(1, (w - padR) / Math.max(1, pts.length));
  const mid = H / 2;
  const p = hover !== null ? pts[hover] : null;
  return (
    <div ref={box} className="relative select-none" style={{ height: H }} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => { const r = box.current?.getBoundingClientRect(); if (!r) return; const i = Math.floor((e.clientX - r.left) / bw); setHover(i >= 0 && i < pts.length ? i : null); }}>
      <svg width={w} height={H} className="block">
        <defs>
          <linearGradient id="nb-pos" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: 'rgb(var(--pos-rgb))', stopOpacity: 0.95 }} /><stop offset="100%" style={{ stopColor: 'rgb(var(--pos-rgb))', stopOpacity: 0.35 }} /></linearGradient>
          <linearGradient id="nb-neg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: 'rgb(var(--neg-rgb))', stopOpacity: 0.35 }} /><stop offset="100%" style={{ stopColor: 'rgb(var(--neg-rgb))', stopOpacity: 0.95 }} /></linearGradient>
        </defs>
        <line x1={0} x2={w - padR} y1={mid} y2={mid} style={{ stroke: 'var(--border-color)' }} />
        {pts.map((q, i) => {
          const h = (Math.abs(q.net) / max) * (mid - 6);
          return <rect key={q.t} x={i * bw + bw * 0.15} width={Math.max(1, bw * 0.7)} y={q.net >= 0 ? mid - h : mid} height={Math.max(0.5, h)} rx={Math.min(2, bw * 0.3)}
            fill={q.net >= 0 ? 'url(#nb-pos)' : 'url(#nb-neg)'} style={{ opacity: hover === null || hover === i ? 1 : 0.5 }} />;
        })}
        <text x={w - padR + 6} y={14} fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>{usd(max)}</text>
        <text x={w - padR + 6} y={H - 4} fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>{usd(-max)}</text>
      </svg>
      {p && (
        <div className="liq-tip pointer-events-none absolute top-0 z-10 rounded-lg px-3 py-2 text-[12px]" style={{ left: Math.min(Math.max(0, hover! * bw + 12), w - 190), width: 180 }}>
          <div className="mb-1 text-[11px] text-[var(--text-tertiary)]">{new Date(p.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</div>
          <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Taker buys</span><span className="tabular-nums text-[var(--text-primary)]">{usd(p.buy)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Taker sells</span><span className="tabular-nums text-[var(--text-primary)]">{usd(p.sell)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Net</span><span className="tabular-nums" style={{ color: p.net >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{signed(p.net)}</span></div>
        </div>
      )}
    </div>
  );
}

export default function OrderFlowPage() {
  const [hours, setHours] = useState<number>(24);
  const [rows, setRows] = useState<FlowRow[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [series, setSeries] = useState<FlowPoint[] | null>(null);
  const { isIn } = useAssetClass();

  useEffect(() => {
    let alive = true; setRows(null);
    const load = () => analytics.getOrderFlow(hours).then((d) => { if (alive) setRows(d.markets); }).catch(() => { if (alive) setRows((r) => r ?? []); });
    load(); const t = window.setInterval(load, 2 * 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [hours]);

  const list = useMemo(() => (rows ?? []).filter((r) => isIn(coinOf(r.symbol))), [rows, isIn]);
  const pick = list.find((r) => r.symbol === sel) ?? list[0] ?? null;
  const days = Math.max(1, Math.ceil(hours / 24));

  useEffect(() => {
    if (!pick) return;
    let alive = true; setSeries(null);
    analytics.getOrderFlowSeries(pick.symbol, days).then((d) => { if (alive) setSeries(d.series.filter((p) => p.t >= Date.now() - hours * 3_600_000)); }).catch(() => { if (alive) setSeries([]); });
    return () => { alive = false; };
  }, [pick?.symbol, hours]); // eslint-disable-line react-hooks/exhaustive-deps

  const buy = list.reduce((a, r) => a + r.buyUsd, 0), sell = list.reduce((a, r) => a + r.sellUsd, 0);
  const share = buy + sell > 0 ? buy / (buy + sell) : 0.5;
  const counts = (Object.keys(KINDS) as FlowKind[]).map((k) => ({ k, n: list.filter((r) => r.kind === k).length })).filter((c) => c.n > 0);
  const maxNet = Math.max(1, ...list.map((r) => Math.abs(r.buyUsd - r.sellUsd)));
  const label = WINDOWS.find(([h]) => h === hours)?.[1];
  const flowPts = (series ?? []).filter((p) => p.buy + p.sell > 0 || p.price !== null);

  return (
    <div className="w-full space-y-4 p-4 md:space-y-6 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2 text-[var(--text-primary)]">
            Order flow
            <InfoTip label="About order flow" width={340}>
              Taker flow is who crossed the spread: a market buy lifts the ask, a market sell hits the bid. Every fill counts once, on the taker’s side. Liquidations aren’t counted (nobody chose them), so totals sit a little under BULK’s 24h volume.
              Price and open interest together say what kind of flow it was: price up with OI up is new longs, price up with OI down is shorts covering,
              price down with OI up is new shorts, price down with OI down is longs closing.
            </InfoTip>
          </h1>
          <p className="mt-1 text-[14px] text-[var(--text-secondary)]">Who’s buying and selling on BULK, and whether positions are opening or closing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AssetClassToggle />
          <div className="toggle-group">{WINDOWS.map(([h, l]) => <button key={h} type="button" onClick={() => setHours(h)} className={cn('toggle-btn', hours === h && 'active')}>{l}</button>)}</div>
        </div>
      </div>

      {!rows ? <div className="h-[480px] animate-pulse rounded-2xl bg-[var(--bg-muted)]" /> : list.length === 0 ? (
        <div className="glass-card px-5 py-10 text-center text-[13px] text-[var(--text-tertiary)]">No flow in this window yet.</div>
      ) : (
        <>
          {/* taker balance */}
          <div className="tint-split rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] px-5 py-4">
            <div className="flex items-end justify-between gap-4">
              <div><div className="text-[12px] text-[var(--text-tertiary)]">Taker buys · {label}</div><div className="text-[24px] font-medium leading-tight tabular-nums" style={{ color: 'var(--pos)' }}>{usd(buy)}</div></div>
              <div className="hidden text-center sm:block">
                <div className="text-[12px] text-[var(--text-tertiary)]">Net · buy share</div>
                <div className="text-[18px] font-medium tabular-nums" style={{ color: buy >= sell ? 'var(--pos)' : 'var(--neg)' }}>{signed(buy - sell)}<span className="ml-2 text-[var(--text-secondary)]">{Math.round(share * 100)}%</span></div>
              </div>
              <div className="text-right"><div className="text-[12px] text-[var(--text-tertiary)]">Taker sells</div><div className="text-[24px] font-medium leading-tight tabular-nums" style={{ color: 'var(--neg)' }}>{usd(sell)}</div></div>
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
              <div className="grad-pos-l transition-[width] duration-700 ease-out" style={{ width: `${share * 100}%` }} />
              <div className="w-0.5" /><div className="grad-neg-r flex-1" />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
              {counts.map((c) => <span key={c.k}><span style={{ color: KINDS[c.k].tone }}>{KINDS[c.k].label}</span> {c.n}</span>)}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* quadrant map */}
            <div className="glass-card flex flex-col p-4 md:p-5">
              <div className="mb-3 flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                Price vs open interest · {label}
                <InfoTip label="Reading the map">Each coin sits by how much its price moved (left to right) and how much its open interest moved (down to up). Click one for its flow.</InfoTip>
              </div>
              <FlowMap rows={list} sel={pick?.symbol ?? null} onPick={setSel} />
            </div>

            {/* selected market */}
            {pick && (
              <div key={pick.symbol} className="glass-card animate-[chart-fade_.35s_ease-out] p-4 md:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <CoinIcon symbol={coinOf(pick.symbol)} size={24} />
                    <div>
                      <div className="text-[15px] font-medium text-[var(--text-primary)]">{pick.symbol}</div>
                      <div className="text-[11px] tabular-nums text-[var(--text-tertiary)]">price {pct(pick.priceChg, 2)} · OI {oiPct(pick.oiChg)} · <Kind k={pick.kind} /></div>
                    </div>
                  </div>
                  <div className="text-right text-[12px] tabular-nums">
                    <div style={{ color: pick.buyUsd >= pick.sellUsd ? 'var(--pos)' : 'var(--neg)' }}>{signed(pick.buyUsd - pick.sellUsd)} net</div>
                    <div className="text-[var(--text-tertiary)]">{(pick.buys + pick.sells).toLocaleString('en-US')} fills</div>
                  </div>
                </div>
                {series === null ? <div className="h-[260px] animate-pulse rounded-xl bg-[var(--bg-base)]" /> : flowPts.length < 2 ? (
                  <p className="py-16 text-center text-[12px] text-[var(--text-tertiary)]">Not enough history in this window yet.</p>
                ) : (
                  <>
                    <div className="mb-1 text-[11px] text-[var(--text-tertiary)]">Net taker flow per hour</div>
                    <NetBars pts={flowPts} />
                    <div className="mb-1 mt-3 text-[11px] text-[var(--text-tertiary)]">Cumulative net flow</div>
                    <SeriesChart height={110} times={flowPts.map((p) => p.t)} animKey={`${pick.symbol}-${hours}`} zeroLine
                      series={[{ key: 'c', label: 'Cumulative net', color: 'var(--accent)', values: flowPts.map((p) => p.cvd) }]} format={(v) => usd(v)} />
                    <div className="mb-1 mt-3 text-[11px] text-[var(--text-tertiary)]">Price</div>
                    <SeriesChart height={90} times={flowPts.map((p) => p.t)} animKey={`${pick.symbol}-${hours}-p`}
                      series={[{ key: 'p', label: 'Price', color: 'var(--text-secondary)', values: flowPts.map((p) => p.price) }]}
                      format={(v) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toPrecision(4))} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* every market */}
          <div className="glass-card overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px] items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)] md:grid-cols-[minmax(0,1fr)_100px_100px_minmax(0,1.4fr)_70px_80px_80px_120px]">
              <span>Market</span><span className="hidden text-right md:block">Taker buys</span><span className="hidden text-right md:block">Taker sells</span><span>Net</span>
              <span className="hidden text-right md:block">Buy share</span><span className="hidden text-right md:block">Price</span><span className="hidden text-right md:block">OI</span><span className="text-right">Flow</span>
            </div>
            {list.map((r, i) => {
              const net = r.buyUsd - r.sellUsd, tot = r.buyUsd + r.sellUsd;
              return (
                <button key={r.symbol} type="button" onClick={() => setSel(r.symbol)} style={{ '--row-index': i } as React.CSSProperties}
                  className={cn('animate-row-enter grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px] items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-left text-[13px] tabular-nums transition-colors last:border-b-0 hover:bg-[var(--bg-base)] md:grid-cols-[minmax(0,1fr)_100px_100px_minmax(0,1.4fr)_70px_80px_80px_120px]',
                    pick?.symbol === r.symbol && 'bg-[var(--bg-base)]')}>
                  <span className="flex min-w-0 items-center gap-2"><CoinIcon symbol={coinOf(r.symbol)} size={18} /><span className="truncate font-medium text-[var(--text-primary)]">{coinOf(r.symbol)}</span></span>
                  <span className="hidden text-right text-[var(--text-secondary)] md:block">{usd(r.buyUsd)}</span>
                  <span className="hidden text-right text-[var(--text-secondary)] md:block">{usd(r.sellUsd)}</span>
                  <span className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-2">
                    <DivergingBar value={net / maxNet} />
                    <span className="text-right text-[12px]" style={{ color: net >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{tot ? signed(net) : '—'}</span>
                  </span>
                  <span className="hidden text-right text-[var(--text-secondary)] md:block">{tot ? `${Math.round((r.buyUsd / tot) * 100)}%` : '—'}</span>
                  <span className="hidden text-right md:block" style={{ color: r.priceChg === null ? undefined : r.priceChg >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{pct(r.priceChg, 2)}</span>
                  <span className="hidden text-right text-[var(--text-secondary)] md:block">{oiPct(r.oiChg)}</span>
                  <span className="text-right"><Kind k={r.kind} /></span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
