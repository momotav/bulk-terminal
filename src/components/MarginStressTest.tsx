'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RiskSurfaces } from '@/lib/api';
import { InfoTip } from '@/components/InfoTip';
import { portfolioMargin, lookupRho, normCoin, FALLBACK_RHO, type MarginLeg } from '@/lib/portfolioMargin';

const money = (n: number, signed = false) => `${signed ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * Stress test for the portfolio above: move one market, let the others follow by
 * their correlation with it (BULK's live matrix), and re-run BULK's portfolio
 * margin on the moved book. Shows PnL, equity vs requirement, and the move that
 * would liquidate the account in each direction.
 */
export function MarginStressTest({ positions, collateral, surfaces, regimeDts, regime, strict }: {
  positions: MarginLeg[]; collateral: number; surfaces: Record<string, RiskSurfaces | null>; regimeDts: Record<string, number>;
  regime: number | 'live'; strict: boolean;
}) {
  const legs = positions.filter((p) => p.notional > 0);
  const assets = Array.from(new Set(legs.map((p) => normCoin(p.asset))));
  const biggest = [...legs].sort((a, b) => b.notional - a.notional)[0];
  const [anchor, setAnchor] = useState<string>(biggest ? normCoin(biggest.asset) : 'BTC');
  const [shock, setShock] = useState(-10);
  useEffect(() => { if (!assets.includes(anchor) && assets[0]) setAnchor(assets[0]); }, [assets.join(','), anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  const corrs = useMemo(() => { for (const s of Object.values(surfaces)) if (s?.corrs?.length) return s.corrs; return undefined; }, [surfaces]);
  const beta = (asset: string) => (normCoin(asset) === anchor ? 1 : (lookupRho(corrs, normCoin(asset), anchor) ?? FALLBACK_RHO));

  /** State of the account after the anchor moves by `s` percent. */
  const at = (s: number) => {
    let pnl = 0;
    const moved = legs.map((p) => {
      const mv = (s / 100) * beta(p.asset);
      pnl += (p.side === 'long' ? 1 : -1) * p.notional * mv;
      return { ...p, notional: Math.max(0, p.notional * (1 + mv)) };
    });
    const equity = collateral + pnl;
    const r = portfolioMargin(moved, { collateral: Math.max(1, equity), surfaces, regimeDts, regime, strict });
    const req = r?.mp ?? 0;
    return { pnl, equity, req, buffer: equity - req };
  };

  // The move that liquidates the account, each way (scan in 0.25% steps).
  const liq = useMemo(() => {
    const find = (dir: 1 | -1, max: number) => {
      for (let s = 0; s <= max; s += 0.25) if (at(dir * s).buffer <= 0) return dir * s;
      return null;
    };
    return { down: find(-1, 95), up: find(1, 300) };
  }, [legs.map((l) => `${l.asset}${l.side}${l.notional}`).join(), collateral, anchor, surfaces, regimeDts, regime, strict]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = at(shock);
  const curve = useMemo(() => Array.from({ length: 101 }, (_, i) => { const s = -50 + i; return { s, b: at(s).buffer }; }),
    [legs.map((l) => `${l.asset}${l.side}${l.notional}`).join(), collateral, anchor, surfaces, regimeDts, regime, strict]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!legs.length) return null;
  const safe = now.buffer > 0;

  return (
    <div className="border-t border-[var(--role-line)] px-4 py-4 lg:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--role-content)]">
            Stress test
            <InfoTip label="How the stress test works" width={340}>
              Move one market; each other leg moves by that move × its correlation to it (BULK’s live matrix), a simplification
              that ignores differences in volatility. Margin is BULK’s portfolio formula re-run on the moved positions;
              liquidation is equity below it.
            </InfoTip>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-[rgb(var(--p-inset))] p-0.5">
          {assets.map((a) => (
            <button key={a} type="button" onClick={() => setAnchor(a)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${anchor === a ? 'bg-[var(--role-surface-raised)] text-[var(--role-content)]' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]'}`}>{a}</button>
          ))}
        </div>
      </div>

      <div className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="text-[var(--role-content-muted)]">{anchor} moves</span>
        <span className="font-medium tabular-nums" style={{ color: shock >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{shock >= 0 ? '+' : '−'}{Math.abs(shock)}%</span>
      </div>
      <input type="range" min={-50} max={50} step={1} value={shock} onChange={(e) => setShock(Number(e.target.value))} className="w-full" style={{ accentColor: 'var(--accent)' }} aria-label={`${anchor} price move`} />

      <BufferCurve curve={curve} shock={shock} />

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--role-line)] bg-[var(--role-line)] md:grid-cols-4">
        <Cell k="PnL" v={money(now.pnl, true)} c={now.pnl >= 0 ? 'var(--pos)' : 'var(--neg)'} />
        <Cell k="Equity" v={money(now.equity)} />
        <Cell k="Margin required" v={money(now.req)} />
        <Cell k="Buffer" v={money(now.buffer, true)} c={safe ? 'var(--role-content)' : 'var(--neg)'} sub={safe ? 'safe' : 'liquidated'} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[var(--role-content-muted)]">
        <span>Liquidated if {anchor} falls <b className="font-medium tabular-nums text-[var(--role-content)]">{liq.down === null ? 'more than 95%' : `${Math.abs(liq.down).toFixed(2)}%`}</b></span>
        <span>or rises <b className="font-medium tabular-nums text-[var(--role-content)]">{liq.up === null ? 'more than 300%' : `${liq.up.toFixed(2)}%`}</b></span>
      </div>
    </div>
  );
}

function BufferCurve({ curve, shock }: { curve: { s: number; b: number }[]; shock: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(600);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, []);
  const H = 90;
  const lo = Math.min(0, ...curve.map((c) => c.b)), hi = Math.max(0, ...curve.map((c) => c.b));
  const x = (s: number) => ((s + 50) / 100) * w;
  const y = (b: number) => 6 + (1 - (b - lo) / Math.max(1, hi - lo)) * (H - 12);
  const d = curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.s).toFixed(1)},${y(c.b).toFixed(1)}`).join(' ');
  return (
    <div ref={ref} className="mt-3">
      <svg width={w} height={H} className="block">
        <defs>
          <clipPath id="stress-above"><rect x={0} y={0} width={w} height={y(0)} /></clipPath>
          <clipPath id="stress-below"><rect x={0} y={y(0)} width={w} height={H} /></clipPath>
        </defs>
        <path d={`${d} L${w},${y(0)} L0,${y(0)} Z`} clipPath="url(#stress-above)" style={{ fill: 'var(--pos)', opacity: 0.12 }} />
        <path d={`${d} L${w},${y(0)} L0,${y(0)} Z`} clipPath="url(#stress-below)" style={{ fill: 'var(--neg)', opacity: 0.18 }} />
        <line x1={0} x2={w} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--role-content-subtle)', opacity: 0.6 }} />
        <path d={d} fill="none" strokeWidth={2} style={{ stroke: 'var(--accent)' }} />
        <line x1={x(shock)} x2={x(shock)} y1={0} y2={H} strokeDasharray="3 3" style={{ stroke: 'var(--role-content)', opacity: 0.6 }} />
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-[var(--role-content-subtle)]"><span>−50%</span><span>buffer (equity − margin) as the market moves</span><span>+50%</span></div>
    </div>
  );
}

function Cell({ k, v, c, sub }: { k: string; v: string; c?: string; sub?: string }) {
  return (
    <div className="bg-[var(--role-surface)] px-3 py-2">
      <div className="text-[11px] text-[var(--role-content-subtle)]">{k}</div>
      <div className="text-[15px] font-medium tabular-nums" style={{ color: c ?? 'var(--role-content)' }}>{v}</div>
      {sub && <div className="text-[10px] text-[var(--role-content-subtle)]">{sub}</div>}
    </div>
  );
}
