'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { analytics, cn, formatAddress, formatCompact, formatNumber, type LiqMapPosition, type LiquidationMapResponse } from '@/lib/api';
import { CoinPick } from '@/components/basket/tools/CoinPick';
import { BulkAvatar } from '@/components/BulkAvatar';
import { InfoTip } from '@/components/InfoTip';

const RANGES = [[0.05, '±5%'], [0.1, '±10%'], [0.25, '±25%'], [0.5, '±50%']] as const;
const BUCKETS = 56;
const BARS_H = 230;   // bar chart height
const CUM_H = 86;     // cumulative chart height
const GAP = 34;       // x-axis band between the two
const AXIS_W = 54;    // right-hand value labels
// Same convention as the past-liquidations map: a long's liquidation is a forced
// sell (red), a short's a forced buy (green).
const LONG = 'var(--neg)';
const SHORT = 'var(--pos)';

const usd = (n: number) => `$${formatCompact(n)}`;
const px = (n: number) => (n >= 1000 ? formatNumber(n, 0) : n >= 1 ? formatNumber(n, 2) : n.toPrecision(4));
const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;

type Bucket = { lo: number; hi: number; long: number; short: number; nLong: number; nShort: number };

/**
 * Where open positions would be liquidated: longs below the price, shorts above,
 * by dollars at each level, and underneath, the running total a move would clear.
 * Built from live account reads of BULK's most active traders; the footer says how
 * much of the market's open interest that covers.
 */
export function LiquidationLevels() {
  const [coin, setCoin] = useState('BTC');
  const [range, setRange] = useState<number>(0.1);
  const [data, setData] = useState<LiquidationMapResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // The cursor line and the readout move straight in the DOM (no re-render per pixel),
  // exactly where the mouse is, like the site's other charts.
  const lineRef = useRef<SVGGElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(800);
  const gid = useId().replace(/:/g, '');

  useEffect(() => {
    let alive = true;
    const load = () => analytics.getLiquidationMap(`${coin}-USD`)
      .then((d) => { if (alive) { setData(d); setErr(null); } })
      .catch((e) => { if (alive) setErr(/warming/i.test(String(e?.message)) ? 'warming' : 'error'); });
    setData(null); setErr(null); load();
    const t = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [coin]);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const mark = data?.mark ?? 0;
  // Dust (under $10) would only add noise to the levels.
  const positions = useMemo(() => (data?.positions ?? []).filter((p) => p.notional >= 10), [data]);
  const lo = mark * (1 - range), hi = mark * (1 + range);
  const plotW = Math.max(200, w - AXIS_W);
  const step = (hi - lo) / BUCKETS;
  const xOf = (price: number) => ((price - lo) / (hi - lo)) * plotW;

  const buckets = useMemo<Bucket[]>(() => {
    if (!mark) return [];
    const out: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, long: 0, short: 0, nLong: 0, nShort: 0 }));
    for (const p of positions) {
      if (p.liq < lo || p.liq >= hi) continue;
      const b = out[Math.min(BUCKETS - 1, Math.floor((p.liq - lo) / step))];
      if (p.side === 'long') { b.long += p.notional; b.nLong++; } else { b.short += p.notional; b.nShort++; }
    }
    return out;
  }, [positions, mark, lo, step]);

  // Running total from the price outwards: longs leftwards, shorts rightwards.
  const cum = useMemo(() => {
    const c = buckets.map(() => 0);
    const mid = buckets.findIndex((b) => b.hi > mark);
    let s = 0; for (let i = mid; i >= 0; i--) { s += buckets[i]?.long ?? 0; c[i] = s; }
    s = 0; for (let i = Math.max(0, mid); i < buckets.length; i++) { s += buckets[i]?.short ?? 0; c[i] = i === mid ? Math.max(c[i], s) : s; }
    return { c, mid };
  }, [buckets, mark]);

  const maxBar = niceMax(Math.max(1, ...buckets.map((b) => Math.max(b.long, b.short))));
  const maxCum = niceMax(Math.max(1, ...cum.c));
  const inRange = positions.filter((p) => p.liq >= lo && p.liq <= hi);
  const longRisk = inRange.filter((p) => p.side === 'long').reduce((s, p) => s + p.notional, 0);
  const shortRisk = inRange.filter((p) => p.side === 'short').reduce((s, p) => s + p.notional, 0);
  const coverage = data?.openInterestUsd ? Math.min(1, (data.coveredUsd ?? 0) / data.openInterestUsd) : null;
  const biggest = (side: 'long' | 'short') => buckets.reduce<Bucket | null>((m, b) => ((side === 'long' ? b.long : b.short) > (m ? (side === 'long' ? m.long : m.short) : 0) ? b : m), null);
  const bigLong = biggest('long'), bigShort = biggest('short');

  const bw = plotW / BUCKETS;
  const H = BARS_H + GAP + CUM_H;
  const yBar = (v: number) => BARS_H - (v / maxBar) * (BARS_H - 14);
  const yCum = (v: number) => BARS_H + GAP + CUM_H - (v / maxCum) * (CUM_H - 8);
  const ticks = [-1, -0.5, 0, 0.5, 1].map((f) => mark * (1 + f * range));

  const read = useMemo(() => {
    if (hover === null || !buckets[hover] || !mark) return null;
    const b = buckets[hover]; const at = (b.lo + b.hi) / 2;
    return { b, at, down: at < mark, total: cum.c[hover] ?? 0, move: (at / mark - 1) * 100 };
  }, [hover, buckets, cum, mark]);

  const nearest = useMemo(() => [...positions]
    .filter((p) => mark > 0 && p.notional >= 1000)
    .map((p) => ({ ...p, dist: Math.abs(p.liq - mark) / mark }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8), [positions, mark]);

  // Smooth cumulative areas, one each side of the price.
  const area = (from: number, to: number) => {
    if (cum.mid < 0) return '';
    const pts: [number, number][] = [];
    for (let i = from; i !== to + (to >= from ? 1 : -1); i += to >= from ? 1 : -1) {
      if (i < 0 || i >= BUCKETS) break;
      pts.push([(i + 0.5) * bw, yCum(cum.c[i])]);
    }
    if (pts.length < 1) return '';
    const base = BARS_H + GAP + CUM_H;
    const xm = xOf(mark);
    return `M${xm},${base} ${pts.map(([x, y]) => `L${x},${y}`).join(' ')} L${pts[pts.length - 1][0]},${base} Z`;
  };

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] [background-image:var(--surface-gradient)] p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base md:text-lg font-semibold text-[var(--text-primary)]">
            Liquidation levels
            {data && <InfoTip label="Where this data comes from">From the live accounts of BULK’s {data.wallets} most active traders, updated {ago(data.at)}.</InfoTip>}
          </h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">Where today’s open positions would be liquidated. Longs sit below the price, shorts above.</p>
        </div>
        <div className="flex items-center gap-2">
          <CoinPick value={coin} onChange={setCoin} align="right" />
          <div className="flex rounded-lg bg-[var(--bg-base)] p-0.5">
            {RANGES.map(([v, l]) => (
              <button key={v} type="button" onClick={() => setRange(v)}
                className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors', range === v ? 'bg-[var(--bg-muted)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--border-color)] md:grid-cols-4">
        <Stat label="Longs at risk" value={data ? usd(longRisk) : '—'} color={LONG} sub={bigLong?.long ? `most near ${px((bigLong.lo + bigLong.hi) / 2)}` : undefined} />
        <Stat label="Shorts at risk" value={data ? usd(shortRisk) : '—'} color={SHORT} sub={bigShort?.short ? `most near ${px((bigShort.lo + bigShort.hi) / 2)}` : undefined} />
        <Stat label={`${coin} price`} value={mark ? px(mark) : '—'} sub={`showing ${RANGES.find((r) => r[0] === range)?.[1]}`} />
        <Stat label="Positions mapped" value={data ? formatNumber(positions.length, 0) : '—'} sub={coverage !== null ? `${(coverage * 100).toFixed(0)}% of open interest` : undefined} />
      </div>

      <div ref={box} className="relative select-none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = box.current?.getBoundingClientRect(); if (!r) return;
          const x = Math.min(Math.max(0, e.clientX - r.left), plotW);
          const y = e.clientY - r.top;
          if (lineRef.current) lineRef.current.style.transform = `translateX(${x}px)`;
          const tip = tipRef.current;
          if (tip) {
            const tw = tip.offsetWidth || 236, th = tip.offsetHeight || 120;
            const tx = x + 18 + tw > w ? x - tw - 18 : x + 18;
            const ty = Math.min(Math.max(0, y - th / 2), H - th);
            tip.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
          }
          const i = Math.min(BUCKETS - 1, Math.max(0, Math.floor(x / bw)));
          setHover((h) => (h === i ? h : i));
        }}>
        {!data ? (
          <div className="flex items-center justify-center text-[13px] text-[var(--text-tertiary)]" style={{ height: H + 24 }}>
            {err === 'warming' ? 'The map is being built from the latest account sweep. Back in a few minutes.' : err ? 'Couldn’t load the map. Retrying…' : 'Loading…'}
          </div>
        ) : (
          <>
            <svg width={w} height={H + 4} className="block overflow-visible" role="img" aria-label={`${coin} liquidation levels`}>
              <defs>
                <linearGradient id={`${gid}l`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: LONG, stopOpacity: 1 }} /><stop offset="100%" style={{ stopColor: LONG, stopOpacity: 0.62 }} /></linearGradient>
                <linearGradient id={`${gid}s`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: SHORT, stopOpacity: 1 }} /><stop offset="100%" style={{ stopColor: SHORT, stopOpacity: 0.62 }} /></linearGradient>
                <linearGradient id={`${gid}la`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: LONG, stopOpacity: 0.32 }} /><stop offset="100%" style={{ stopColor: LONG, stopOpacity: 0.02 }} /></linearGradient>
                <linearGradient id={`${gid}sa`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style={{ stopColor: SHORT, stopOpacity: 0.32 }} /><stop offset="100%" style={{ stopColor: SHORT, stopOpacity: 0.02 }} /></linearGradient>
              </defs>

              {/* grid + value labels: bars */}
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <g key={`g${f}`}>
                  <line x1={0} x2={plotW} y1={yBar(maxBar * f)} y2={yBar(maxBar * f)} strokeDasharray="2 5" style={{ stroke: 'var(--border-color)' }} />
                  <text x={plotW + 8} y={yBar(maxBar * f) + 3} fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>{usd(maxBar * f)}</text>
                </g>
              ))}
              <line x1={0} x2={plotW} y1={BARS_H} y2={BARS_H} style={{ stroke: 'var(--border-color)' }} />

              {/* bars */}
              {buckets.map((b, i) => {
                const v = Math.max(b.long, b.short); if (!v) return null;
                const isLong = b.long >= b.short;
                const y = yBar(v), x = i * bw + 1, bwid = Math.max(1.5, bw - 2);
                return (
                  <rect key={i} x={x} y={y} width={bwid} height={BARS_H - y} rx={Math.min(3, bwid / 2)}
                    fill={`url(#${gid}${isLong ? 'l' : 's'})`} opacity={hover !== null && hover !== i ? 0.4 : 1}
                    style={{ transition: 'opacity 160ms ease' }} />
                );
              })}

              {/* price axis */}
              {ticks.map((t, k) => (
                <g key={`t${k}`}>
                  <line x1={xOf(t)} x2={xOf(t)} y1={BARS_H} y2={BARS_H + 4} style={{ stroke: 'var(--border-color)' }} />
                  <text x={xOf(t)} y={BARS_H + 16} fontSize={10} textAnchor={k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'} style={{ fill: k === 2 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{px(t)}</text>
                  {k !== 2 && <text x={xOf(t)} y={BARS_H + 27} fontSize={9} textAnchor={k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'} style={{ fill: 'var(--text-tertiary)', opacity: 0.7 }}>{pct((t / mark - 1) * 100)}</text>}
                </g>
              ))}

              {/* cumulative */}
              <line x1={0} x2={plotW} y1={BARS_H + GAP + CUM_H} y2={BARS_H + GAP + CUM_H} style={{ stroke: 'var(--border-color)' }} />
              <path d={area(cum.mid, 0)} fill={`url(#${gid}la)`} />
              <path d={area(cum.mid, BUCKETS - 1)} fill={`url(#${gid}sa)`} />
              <text x={plotW + 8} y={yCum(maxCum) + 3} fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>{usd(maxCum)}</text>
              <text x={4} y={BARS_H + GAP + 10} fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>Total liquidated if price moves here</text>

              {/* the current price */}
              <line x1={xOf(mark)} x2={xOf(mark)} y1={14} y2={H} strokeDasharray="3 4" style={{ stroke: 'var(--text-secondary)', opacity: 0.7 }} />
              <g transform={`translate(${xOf(mark)}, 0)`}>
                <rect x={-34} y={-2} width={68} height={18} rx={9} style={{ fill: 'var(--text-primary)' }} />
                <text x={0} y={11} fontSize={10.5} textAnchor="middle" fontWeight={500} style={{ fill: 'var(--bg-muted)' }}>{px(mark)}</text>
              </g>

              {/* hover */}
              <g ref={lineRef} style={{ opacity: hover === null ? 0 : 1, transition: 'opacity 150ms ease' }}>
                <line x1={0} x2={0} y1={0} y2={H} style={{ stroke: 'var(--text-primary)', opacity: 0.35 }} />
                {read && <circle cx={0} cy={yCum(read.total)} r={3.5} style={{ fill: read.down ? LONG : SHORT, stroke: 'var(--bg-muted)', strokeWidth: 2, transition: 'cy 160ms ease-out' }} />}
              </g>
            </svg>

            {(
              <div ref={tipRef} className="liq-tip pointer-events-none absolute left-0 top-0 z-10 w-[236px] rounded-xl px-3.5 py-3 text-[12px]"
                style={{ opacity: read ? 1 : 0, transition: 'opacity 150ms ease', willChange: 'transform' }}>
                {read && <>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-medium tabular-nums text-[var(--text-primary)]">{px(read.at)}</span>
                  <span className="tabular-nums text-[var(--text-tertiary)]">{pct(read.move)}</span>
                </div>
                {(read.b.long > 0 || read.b.short > 0) ? (
                  <div className="mt-2 space-y-1">
                    {read.b.long > 0 && <Line dot={LONG} k="Longs liquidated here" v={`${usd(read.b.long)} · ${read.b.nLong}`} />}
                    {read.b.short > 0 && <Line dot={SHORT} k="Shorts liquidated here" v={`${usd(read.b.short)} · ${read.b.nShort}`} />}
                  </div>
                ) : <div className="mt-2 text-[var(--text-tertiary)]">No liquidations at this level</div>}
                <div className="mt-2.5 border-t border-[var(--border-color)] pt-2 leading-snug text-[var(--text-secondary)]">
                  {read.total > 0
                    ? <>If {coin} {read.down ? 'falls' : 'rises'} here, <span className="font-medium text-[var(--text-primary)]">{usd(read.total)}</span> of {read.down ? 'longs' : 'shorts'} get liquidated on the way.</>
                    : <>A move here liquidates no mapped {read.down ? 'longs' : 'shorts'} yet.</>}
                </div>
                </>}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: LONG }} />Long liquidations</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: SHORT }} />Short liquidations</span>
      </div>

      {nearest.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">Closest to liquidation</span>
            <span className="text-[11px] text-[var(--text-tertiary)]">distance from {px(mark)}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)]">
            {nearest.map((p) => <NearRow key={`${p.wallet}${p.side}${p.liq}`} p={p} mark={mark} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Round a max up to a tidy axis value (1, 2, 2.5, 5 × 10^n). */
function niceMax(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-[var(--bg-base)] px-4 py-3">
      <div className="text-[11px] text-[var(--text-tertiary)]">{label}</div>
      <div className="mt-0.5 text-[18px] font-medium tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] tabular-nums text-[var(--text-tertiary)]">{sub}</div>}
    </div>
  );
}

function Line({ dot, k, v }: { dot: string; k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-sm" style={{ background: dot }} />{k}</span>
      <span className="tabular-nums text-[var(--text-primary)]">{v}</span>
    </div>
  );
}

function NearRow({ p, mark }: { p: LiqMapPosition & { dist: number }; mark: number }) {
  const long = p.side === 'long';
  const color = long ? LONG : SHORT;
  // How close: a full bar is right at the price, empty is 25% or more away.
  const close = Math.max(0.04, 1 - Math.min(1, p.dist / 0.25));
  return (
    <Link href={`/wallet/${p.wallet}`} className="flex items-center gap-3 border-b border-[var(--border-color)] px-3.5 py-2.5 text-[12px] transition-colors last:border-b-0 hover:bg-[var(--bg-muted)]">
      <BulkAvatar seed={p.wallet} size={24} />
      <span className="w-[86px] font-mono text-[11px] text-[var(--text-secondary)]">{formatAddress(p.wallet)}</span>
      <span className="w-12 font-medium" style={{ color }}>{long ? 'Long' : 'Short'}</span>
      <span className="w-20 tabular-nums text-[var(--text-primary)]">{usd(p.notional)}</span>
      <span className="hidden w-28 tabular-nums text-[var(--text-tertiary)] sm:inline">liq {px(p.liq)}</span>
      <span className="relative ml-auto hidden h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-muted)] sm:block">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${close * 100}%`, background: color, opacity: 0.8 }} />
      </span>
      <span className="w-[92px] whitespace-nowrap text-right tabular-nums" style={{ color: p.dist < 0.03 ? 'var(--neg)' : 'var(--text-secondary)' }}>
        {(p.dist * 100).toFixed(1)}% {p.liq < mark ? 'below' : 'above'}
      </span>
    </Link>
  );
}
