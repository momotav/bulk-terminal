'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { analytics, cn, formatAddress, formatCompact, formatNumber, type LiqMapPosition, type LiquidationMapResponse } from '@/lib/api';
import { CoinIcon } from '@/components/CoinIcon';
import { CoinPick } from '@/components/basket/tools/CoinPick';

const RANGES = [[0.05, '±5%'], [0.1, '±10%'], [0.25, '±25%'], [0.5, '±50%']] as const;
const BUCKETS = 64;
const H = 220; // bar area height (px)

const usd = (n: number) => `$${formatCompact(n)}`;
const px = (n: number) => (n >= 1000 ? formatNumber(n, 0) : n >= 1 ? formatNumber(n, 2) : n.toPrecision(4));
const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };

type Bucket = { lo: number; hi: number; long: number; short: number; nLong: number; nShort: number };

/**
 * Where open positions would be liquidated: longs below the price, shorts above,
 * stacked by dollars at each level, with a heat strip for clusters. Built from live
 * account reads of BULK's most active traders; the coverage line says how much of
 * the market's open interest that is.
 */
export function LiquidationLevels() {
  const [coin, setCoin] = useState('BTC');
  const [range, setRange] = useState<number>(0.1);
  const [data, setData] = useState<LiquidationMapResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(800);

  useEffect(() => {
    let alive = true;
    const load = () => analytics.getLiquidationMap(`${coin}-USD`)
      .then((d) => { if (alive) { setData(d); setErr(null); } })
      .catch((e) => { if (alive) setErr(/warming/i.test(String(e?.message)) ? 'warming' : 'error'); });
    setData(null); load();
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

  const buckets = useMemo<Bucket[]>(() => {
    if (!mark) return [];
    const step = (hi - lo) / BUCKETS;
    const out: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, long: 0, short: 0, nLong: 0, nShort: 0 }));
    for (const p of positions) {
      if (p.liq < lo || p.liq >= hi) continue;
      const b = out[Math.min(BUCKETS - 1, Math.floor((p.liq - lo) / step))];
      if (p.side === 'long') { b.long += p.notional; b.nLong++; } else { b.short += p.notional; b.nShort++; }
    }
    return out;
  }, [positions, mark, lo, hi]);

  const max = Math.max(1, ...buckets.map((b) => b.long + b.short));
  const inRange = positions.filter((p) => p.liq >= lo && p.liq <= hi);
  const longRisk = inRange.filter((p) => p.side === 'long').reduce((s, p) => s + p.notional, 0);
  const shortRisk = inRange.filter((p) => p.side === 'short').reduce((s, p) => s + p.notional, 0);
  const coverage = data?.openInterestUsd ? Math.min(1, (data.coveredUsd ?? 0) / data.openInterestUsd) : null;
  const bw = w / BUCKETS;
  const xOf = (price: number) => ((price - lo) / (hi - lo)) * w;

  // Hover: what a move to this price would liquidate (cumulative from the mark).
  const read = useMemo(() => {
    if (hover === null || !buckets[hover] || !mark) return null;
    const b = buckets[hover]; const at = (b.lo + b.hi) / 2;
    const down = at < mark;
    let sum = 0, n = 0;
    for (const p of positions) {
      if (down && p.side === 'long' && p.liq >= at && p.liq <= mark) { sum += p.notional; n++; }
      if (!down && p.side === 'short' && p.liq <= at && p.liq >= mark) { sum += p.notional; n++; }
    }
    return { b, at, down, sum, n, move: (at / mark - 1) * 100 };
  }, [hover, buckets, positions, mark]);

  // Closest big positions to liquidation, either side.
  const nearest = useMemo(() => [...positions]
    .filter((p) => mark > 0 && p.notional >= 1000)
    .map((p) => ({ ...p, dist: Math.abs(p.liq - mark) / mark }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8), [positions, mark]);

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-muted)] p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Liquidation levels</h2>
          <p className="text-[12px] text-[var(--text-tertiary)]">Where today’s open positions would be liquidated: longs below the price, shorts above.</p>
        </div>
        <div className="flex items-center gap-2">
          <CoinPick value={coin} onChange={setCoin} align="right" />
          <div className="flex rounded-lg bg-[var(--bg-base)] p-0.5">
            {RANGES.map(([v, l]) => (
              <button key={v} type="button" onClick={() => setRange(v)}
                className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors', range === v ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Longs at risk (${RANGES.find((r) => r[0] === range)?.[1]})`} value={data ? usd(longRisk) : '—'} color="var(--neg)" />
        <Stat label={`Shorts at risk (${RANGES.find((r) => r[0] === range)?.[1]})`} value={data ? usd(shortRisk) : '—'} color="var(--pos)" />
        <Stat label={`${coin} price`} value={mark ? px(mark) : '—'} />
        <Stat label="Positions mapped" value={data ? formatNumber(positions.length, 0) : '—'} />
      </div>

      <div ref={box} className="relative select-none" onMouseLeave={() => setHover(null)}>
        {!data ? (
          <div className="flex items-center justify-center text-[13px] text-[var(--text-tertiary)]" style={{ height: H + 46 }}>
            {err === 'warming' ? 'The map is being built from the latest account sweep. Back in a few minutes.' : err ? 'Couldn’t load the map. Retrying…' : 'Loading…'}
          </div>
        ) : (
          <>
            <svg width={w} height={H + 46} className="block" role="img" aria-label={`${coin} liquidation map`}>
              {/* bars */}
              {buckets.map((b, i) => {
                const tot = b.long + b.short; if (!tot) return null;
                const hL = (b.long / max) * (H - 8), hS = (b.short / max) * (H - 8);
                const x = i * bw + 1, bwid = Math.max(1, bw - 2);
                const dim = hover !== null && hover !== i ? 0.45 : 1;
                return (
                  <g key={i} opacity={dim}>
                    {hL > 0 && <rect x={x} y={H - hL} width={bwid} height={hL} rx={Math.min(3, bwid / 2)} style={{ fill: 'var(--neg)' }} />}
                    {hS > 0 && <rect x={x} y={H - hL - hS - (hL > 0 ? 2 : 0)} width={bwid} height={hS} rx={Math.min(3, bwid / 2)} style={{ fill: 'var(--pos)' }} />}
                  </g>
                );
              })}
              {/* heat strip: density of liquidations along the price axis */}
              {buckets.map((b, i) => {
                const tot = b.long + b.short;
                return <rect key={`h${i}`} x={i * bw} y={H + 6} width={bw + 0.5} height={10} style={{ fill: 'var(--accent)', opacity: tot ? 0.12 + 0.88 * Math.sqrt(tot / max) : 0.05 }} />;
              })}
              {/* the current price */}
              <line x1={xOf(mark)} x2={xOf(mark)} y1={0} y2={H + 16} strokeDasharray="4 4" style={{ stroke: 'var(--text-secondary)' }} />
              <text x={xOf(mark)} y={H + 34} textAnchor="middle" fontSize={11} style={{ fill: 'var(--text-primary)' }}>{px(mark)}</text>
              <text x={2} y={H + 34} fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>{px(lo)}</text>
              <text x={w - 2} y={H + 34} textAnchor="end" fontSize={10} style={{ fill: 'var(--text-tertiary)' }}>{px(hi)}</text>
              {/* hover targets */}
              {buckets.map((_, i) => <rect key={`t${i}`} x={i * bw} y={0} width={bw} height={H + 20} fill="transparent" onMouseEnter={() => setHover(i)} />)}
            </svg>
            {read && (
              <div className="pointer-events-none absolute top-2 z-10 w-[230px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2 text-[12px] shadow-xl"
                style={{ left: Math.min(Math.max(0, (hover ?? 0) * bw - 115), w - 230) }}>
                <div className="text-[var(--text-tertiary)]">{px(read.b.lo)} – {px(read.b.hi)} · {read.move >= 0 ? '+' : '−'}{Math.abs(read.move).toFixed(1)}%</div>
                {read.b.long > 0 && <div className="mt-1 flex justify-between"><span style={{ color: 'var(--neg)' }}>Longs here</span><span className="tabular-nums text-[var(--text-primary)]">{usd(read.b.long)} · {read.b.nLong}</span></div>}
                {read.b.short > 0 && <div className="flex justify-between"><span style={{ color: 'var(--pos)' }}>Shorts here</span><span className="tabular-nums text-[var(--text-primary)]">{usd(read.b.short)} · {read.b.nShort}</span></div>}
                <div className="mt-1.5 border-t border-[var(--border-color)] pt-1.5 text-[var(--text-secondary)]">
                  If {coin} {read.down ? 'falls' : 'rises'} to {px(read.at)}: <span className="font-medium text-[var(--text-primary)]">{usd(read.sum)}</span> of {read.down ? 'longs' : 'shorts'} liquidated ({read.n})
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--neg)' }} />Long liquidations</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: 'var(--pos)' }} />Short liquidations</span>
        {data && (
          <span className="ml-auto">
            {data.wallets} most active traders{coverage !== null ? ` · covers ${(coverage * 100).toFixed(0)}% of ${coin} open interest` : ''} · updated {ago(data.at)}
          </span>
        )}
      </div>

      {nearest.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[13px] font-medium text-[var(--text-primary)]">Closest to liquidation</div>
          <div className="overflow-hidden rounded-lg border border-[var(--border-color)]">
            {nearest.map((p) => <NearRow key={`${p.wallet}${p.side}`} p={p} coin={coin} mark={mark} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2">
      <div className="text-[11px] text-[var(--text-tertiary)]">{label}</div>
      <div className="text-[16px] font-medium tabular-nums" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function NearRow({ p, coin, mark }: { p: LiqMapPosition & { dist: number }; coin: string; mark: number }) {
  const long = p.side === 'long';
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-3 py-2 text-[12px] last:border-b-0">
      <CoinIcon symbol={coin} size={16} />
      <span className="w-14" style={{ color: long ? 'var(--neg)' : 'var(--pos)' }}>{long ? 'Long' : 'Short'}</span>
      <span className="w-20 tabular-nums text-[var(--text-primary)]">{usd(p.notional)}</span>
      <span className="flex-1 tabular-nums text-[var(--text-secondary)]">liq {px(p.liq)}</span>
      <span className="w-28 whitespace-nowrap text-right tabular-nums" style={{ color: p.dist < 0.03 ? 'var(--neg)' : 'var(--text-tertiary)' }}>
        {(p.dist * 100).toFixed(1)}% {p.liq < mark ? 'below' : 'above'}
      </span>
      <Link href={`/wallet/${p.wallet}`} className="w-[86px] text-right font-mono text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">{formatAddress(p.wallet)}</Link>
    </div>
  );
}
