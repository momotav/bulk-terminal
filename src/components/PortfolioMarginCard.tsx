'use client';

import { useEffect, useMemo, useState } from 'react';
import { analytics, cn, formatCompact, formatNumber, type RiskSurfaces } from '@/lib/api';
import { CoinPicker } from '@/components/CoinPicker';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { Layers, Plus, X } from 'lucide-react';

// ----------------------------------------------------------------------------
// PortfolioMarginCard — a faithful port of BULK's published portfolio-margin
// calculator (docs.bulk.trade). NOT a model: it runs the same pipeline BULK
// documents, on the same live data.
//
//   1. signed notional      sN_i = sign_i · notional_i
//   2. effective notional   N_eff = √(Σ sN_i² + 2·Σ_{i<j} sN_i·sN_j·ρ_ij)
//   3. portfolio leverage   L = N_eff / collateral
//   4. lambda lookup        bilinear interp on the regime surface at
//                           (notional_i, L), with time decay
//                           λ(t) = mmrE + (mmrO − mmrE)·p^t,  t = regimeDt
//   5. signed margin        M_i = sign_i · λ_i · notional_i
//   6. portfolio margin     M_p = √(Σ M_i² + 2·Σ_{i<j} M_i·M_j·ρ_ij)
//   7. margin usage         M_p / collateral
//   8. hedge discount       (1 − M_p / Σ|M_i|) · 100
//
// ρ is BULK's real correlation matrix (the `corrs` field). λ comes from the
// published risk surfaces. regimeDt (time elapsed in the current regime) comes
// from the live regime feed. There is no artificial cap — the netting itself
// produces the reduction, exactly as in BULK's calculator.
// ----------------------------------------------------------------------------

type Side = 'long' | 'short';
interface Position { id: number; asset: string; side: Side; notional: number; }

const REGIMES: { id: number; label: string }[] = [
  { id: -12, label: 'Bear / High' }, { id: -11, label: 'Bear / Med' }, { id: -10, label: 'Bear / Low' },
  { id: 0, label: 'Neutral / Low' }, { id: 1, label: 'Neutral / Med' }, { id: 2, label: 'Neutral / High' },
  { id: 10, label: 'Bull / Low' }, { id: 11, label: 'Bull / Med' }, { id: 12, label: 'Bull / High' },
];

const FALLBACK_LAMBDA = 0.02; // 2% - BULK's surface floor, if a cell is missing.
const norm = (s: string) => s.replace(/-USD$/i, '').trim().toUpperCase();

/** λ(t) = mmrE + (mmrO − mmrE)·p^t — BULK's regime time-decay. t=0 ⇒ strict (mmrO). */
function decayedLambda(mmrO: number, mmrE: number, p: number, t: number): number {
  if (t <= 0) return mmrO;
  if (!p || p <= 0 || p >= 1) return mmrO;
  return mmrE + (mmrO - mmrE) * Math.pow(p, t);
}

/** Bilinear-interpolated λ on a regime surface at (notional, leverage), with decay. */
function lookupLambda(surf: RiskSurfaces | null, regime: number, notional: number, leverage: number, side: Side, dt: number): number {
  if (!surf) return FALLBACK_LAMBDA;
  const entry = surf.surfaces.find((s) => s.regime === regime)
    ?? surf.surfaces.find((s) => s.regime === surf.liveRegime)
    ?? surf.surfaces[0];
  if (!entry) return FALLBACK_LAMBDA;
  const lev = entry.leverage; const nots = entry.notionals;
  const grid = side === 'long' ? entry.buy : entry.sell;
  if (!grid?.length || !lev?.length || !nots?.length) return FALLBACK_LAMBDA;

  const bracket = (knots: number[], x: number): [number, number, number] => {
    if (x <= knots[0]) return [0, 0, 0];
    if (x >= knots[knots.length - 1]) return [knots.length - 1, knots.length - 1, 0];
    for (let i = 0; i < knots.length - 1; i++) {
      if (x >= knots[i] && x <= knots[i + 1]) return [i, i + 1, (x - knots[i]) / (knots[i + 1] - knots[i])];
    }
    return [0, 0, 0];
  };
  const [ni0, ni1, nt] = bracket(nots, notional);
  const [li0, li1, lt] = bracket(lev, leverage);
  const cell = (ni: number, li: number) => {
    const c = grid[ni]?.[li];
    return c ? decayedLambda(c.mmrO, c.mmrE, c.p, dt) : FALLBACK_LAMBDA;
  };
  const top = cell(ni0, li0) + lt * (cell(ni0, li1) - cell(ni0, li0));
  const bot = cell(ni1, li0) + lt * (cell(ni1, li1) - cell(ni1, li0));
  return top + nt * (bot - top);
}

/** BULK correlation ρ for an unordered pair, from the colon-joined `corrs` matrix. */
function lookupRho(corrs: RiskSurfaces['corrs'] | undefined, a: string, b: string): number | null {
  if (!corrs) return null;
  const A = norm(a); const B = norm(b);
  if (A === B) return 1;
  for (const [pair, r] of corrs) {
    const [x, y] = String(pair).split(':');
    if (x === undefined || y === undefined) continue;
    if ((norm(x) === A && norm(y) === B) || (norm(x) === B && norm(y) === A)) return r;
  }
  return null;
}

export function PortfolioMarginCard() {
  const { network } = useCurrentNetwork();

  const [positions, setPositions] = useState<Position[]>([
    { id: 1, asset: 'BTC', side: 'long', notional: 100_000 },
    { id: 2, asset: 'ETH', side: 'short', notional: 100_000 },
  ]);
  const [nextId, setNextId] = useState(3);
  const [collateral, setCollateral] = useState(25_000);
  const [regimeSel, setRegimeSel] = useState<number | 'live'>('live');
  const [aggRegime, setAggRegime] = useState<number | null>(null);
  const [mode, setMode] = useState<'live' | 'strict'>('live');

  const [surfaces, setSurfaces] = useState<Record<string, RiskSurfaces | null>>({});
  const [regimeDts, setRegimeDts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Fetch risk surfaces for every distinct asset in the book (each carries the
  // full corrs matrix, so any one supplies correlations). Refetch on network.
  const assetKey = positions.map((p) => p.asset).sort().join(',');
  useEffect(() => {
    let cancelled = false;
    const unique = Array.from(new Set(positions.map((p) => norm(p.asset))));
    setLoading(true);
    Promise.all(unique.map((a) => analytics.getRiskSurfaces(a).then((r) => [a, r] as const).catch(() => [a, null] as const)))
      .then((pairs) => {
        if (cancelled) return;
        const map: Record<string, RiskSurfaces | null> = {};
        for (const [a, r] of pairs) map[a] = r;
        setSurfaces(map);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetKey, network]);

  // Live regimeDt (time-in-regime) per market, for the decay term.
  useEffect(() => {
    let cancelled = false;
    analytics.getRegimeData()
      .then((d) => {
        if (cancelled) return;
        const m: Record<string, number> = {};
        for (const mk of d.markets) m[norm(mk.symbol)] = mk.regimeDt;
        setRegimeDts(m);
        setAggRegime(d.aggregateRegime);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [network]);

  // Any one fetched surface carries the full correlation matrix.
  const corrs = useMemo(() => {
    for (const s of Object.values(surfaces)) if (s?.corrs?.length) return s.corrs;
    return undefined;
  }, [surfaces]);

  const calc = useMemo(() => {
    const C = collateral || 1;
    const pos = positions.filter((p) => p.notional > 0);
    if (!pos.length) return null;

    const rho = (i: number, j: number) => lookupRho(corrs, pos[i].asset, pos[j].asset) ?? 0.75;
    const sign = (p: Position) => (p.side === 'long' ? 1 : -1);

    // Effective notional.
    const sN = pos.map((p) => sign(p) * p.notional);
    let nEffSq = 0;
    for (let i = 0; i < pos.length; i++) {
      nEffSq += sN[i] * sN[i];
      for (let j = i + 1; j < pos.length; j++) nEffSq += 2 * sN[i] * sN[j] * rho(i, j);
    }
    const nEff = Math.sqrt(Math.max(0, nEffSq));
    const portLev = nEff / C;

    // Per-position λ at portfolio leverage, then signed margins.
    const dtFor = (p: Position) => (mode === 'strict' ? 0 : (regimeDts[norm(p.asset)] ?? 0));
    const regimeFor = (p: Position) => (regimeSel === 'live' ? (surfaces[norm(p.asset)]?.liveRegime ?? 0) : regimeSel);
    const lambdas = pos.map((p) => lookupLambda(surfaces[norm(p.asset)] ?? null, regimeFor(p), p.notional, portLev, p.side, dtFor(p)));
    const M = pos.map((p, i) => sign(p) * lambdas[i] * p.notional);

    let mpSq = 0;
    for (let i = 0; i < pos.length; i++) {
      mpSq += M[i] * M[i];
      for (let j = i + 1; j < pos.length; j++) mpSq += 2 * M[i] * M[j] * rho(i, j);
    }
    const mp = Math.sqrt(Math.max(0, mpSq));
    const sumM = lambdas.reduce((a, l, i) => a + Math.abs(l * pos[i].notional), 0);
    const sumN = pos.reduce((a, p) => a + p.notional, 0);
    const hedgeDiscount = pos.length > 1 && sumM > 0 ? (1 - mp / sumM) * 100 : 0;
    const marginUsage = mp / C;
    const efficiency = mp > 0 ? sumM / mp : 0;

    const pairs: { label: string; rho: number }[] = [];
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      pairs.push({ label: `${norm(pos[i].asset)} / ${norm(pos[j].asset)}`, rho: rho(i, j) });
    }
    const rows = pos.map((p, i) => ({ asset: norm(p.asset), side: p.side, notional: p.notional, lambda: lambdas[i], margin: Math.abs(M[i]) }));

    return { sumN, nEff, portLev, sumM, mp, hedgeDiscount, marginUsage, efficiency, pairs, rows };
  }, [positions, collateral, regimeSel, mode, surfaces, regimeDts, corrs]);

  const addPos = () => {
    setPositions((p) => [...p, { id: nextId, asset: 'SOL', side: 'long', notional: 50_000 }]);
    setNextId((n) => n + 1);
  };
  const removePos = (id: number) => setPositions((p) => (p.length > 1 ? p.filter((x) => x.id !== id) : p));
  const update = (id: number, patch: Partial<Position>) => setPositions((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const capitalFreed = calc ? Math.max(0, calc.sumM - calc.mp) : 0;

  return (
    <div className="glass-card flex flex-col">
      {/* Header */}
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="panel-title t-h2 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--accent)]" /> Portfolio Margining
          </h2>
          <p className="t-caption truncate">Build a book — BULK nets correlated legs and the requirement drops.</p>
        </div>
        <div className="toggle-group shrink-0">
          {(['live', 'strict'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn('toggle-btn capitalize', mode === m && 'active')}>{m}</button>
          ))}
        </div>
      </div>

      {/* Two-column cockpit: builder (left) · result (right). Stacks under lg. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* ── LEFT · builder ─────────────────────────────────────────── */}
        <div className="p-4 lg:p-5 lg:border-r border-[var(--role-line)] space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="t-caption uppercase tracking-wider">Collateral (USDC)</span>
              <input
                type="text"
                value={`$${collateral.toLocaleString('en-US')}`}
                onChange={(e) => setCollateral(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
                className="mt-1 w-full bg-[rgb(var(--p-inset))] border border-[var(--role-line)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm font-mono text-[var(--role-content)] outline-none focus:border-[var(--role-content-subtle)] transition-colors"
              />
            </label>
            <label className="block">
              <span className="t-caption uppercase tracking-wider">Regime</span>
              <select
                value={regimeSel === 'live' ? 'live' : String(regimeSel)}
                onChange={(e) => setRegimeSel(e.target.value === 'live' ? 'live' : Number(e.target.value))}
                className="mt-1 w-full bg-[rgb(var(--p-inset))] border border-[var(--role-line)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm text-[var(--role-content)] outline-none cursor-pointer focus:border-[var(--role-content-subtle)] transition-colors"
              >
                <option value="live">Live{aggRegime !== null ? ` (${aggRegime >= 0 ? '+' : ''}${Math.round(aggRegime)})` : ''}</option>
                {REGIMES.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.label}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="t-caption uppercase tracking-wider">Positions</span>
              <span className="t-caption">{positions.length} legs</span>
            </div>
            {positions.map((p) => (
              <div key={p.id} className="bg-[rgb(var(--p-inset))] border border-[var(--role-line)] rounded-[var(--radius-md)] p-2.5">
                <div className="flex items-center gap-2">
                  <div className="shrink-0"><CoinPicker value={p.asset} onChange={(c) => update(p.id, { asset: c })} ariaLabel="Asset" /></div>
                  <div className="flex rounded-[var(--radius-sm)] border border-[var(--role-line)] overflow-hidden text-[11px] font-bold shrink-0">
                    <button onClick={() => update(p.id, { side: 'long' })} className={cn('px-2 py-1 transition-colors', p.side === 'long' ? 'bg-[var(--pos)]/20 text-[var(--pos)]' : 'text-[var(--role-content-subtle)]')}>LONG</button>
                    <button onClick={() => update(p.id, { side: 'short' })} className={cn('px-2 py-1 transition-colors', p.side === 'short' ? 'bg-[var(--neg)]/20 text-[var(--neg)]' : 'text-[var(--role-content-subtle)]')}>SHORT</button>
                  </div>
                  <div className="flex-1" />
                  <button onClick={() => removePos(p.id)} className="shrink-0 text-[var(--role-content-subtle)] hover:text-[var(--neg)] transition-colors p-1" aria-label="Remove"><X className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex items-center gap-1 shrink-0 w-28 bg-[var(--role-surface)] border border-[var(--role-line)] rounded-[var(--radius-sm)] px-2 py-1">
                    <span className="text-[var(--role-content-subtle)] text-xs">$</span>
                    <input
                      type="text"
                      value={p.notional.toLocaleString('en-US')}
                      onChange={(e) => update(p.id, { notional: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
                      className="w-full bg-transparent text-sm font-mono text-[var(--role-content)] outline-none min-w-0"
                    />
                  </div>
                  <input
                    type="range" min={10_000} max={1_000_000} step={10_000}
                    value={Math.min(1_000_000, Math.max(10_000, p.notional))}
                    onChange={(e) => update(p.id, { notional: Number(e.target.value) })}
                    className="flex-1 h-1.5 cursor-pointer min-w-0"
                    style={{ accentColor: p.side === 'long' ? 'var(--pos)' : 'var(--neg)' }}
                  />
                </div>
              </div>
            ))}
            <button onClick={addPos} className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--role-line)] text-[11px] text-[var(--role-content-muted)] hover:bg-[rgb(var(--p-inset))] hover:text-[var(--role-content)] transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add position
            </button>
          </div>
        </div>

        {/* ── RIGHT · result ─────────────────────────────────────────── */}
        <div className="p-4 lg:p-5 flex flex-col gap-4 border-t lg:border-t-0 border-[var(--role-line)]">
          {calc ? (
            <>
              {/* HERO — capital freed by netting. */}
              <div className="rounded-[var(--radius-md)] bg-[rgb(var(--p-inset))] border border-[var(--pos)]/25 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="t-caption uppercase tracking-wider">Capital freed by netting</span>
                  {calc.hedgeDiscount > 0 && (
                    <span className="text-[11px] font-semibold text-[var(--pos)] tabular-nums">−{calc.hedgeDiscount.toFixed(1)}%</span>
                  )}
                </div>
                <div className="mt-1 font-mono font-bold tabular-nums text-[28px] leading-none text-[var(--pos)]">
                  {loading ? '—' : `$${formatNumber(capitalFreed, 0)}`}
                </div>
                <p className="t-caption mt-1.5">
                  vs. margining each leg separately — {loading ? '' : `${calc.efficiency.toFixed(1)}× more capital-efficient`}
                </p>
              </div>

              {/* Sum-of-legs vs BULK comparison. */}
              <div className="space-y-2.5">
                <CompareBar label="Sum of legs" sub="separate margin" value={calc.sumM} widthPct={1} barClass="bg-[var(--role-content-subtle)]/50" />
                <CompareBar label="BULK portfolio" sub="netted by correlation" value={calc.mp} widthPct={calc.sumM > 0 ? calc.mp / calc.sumM : 0} barClass="bg-[var(--pos)]" highlight />
              </div>

              {/* Metric wells. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Metric label="Efficiency" value={loading ? '—' : `${calc.efficiency.toFixed(1)}x`} tone="green" />
                <Metric label="Margin usage" value={loading ? '—' : `${(calc.marginUsage * 100).toFixed(1)}%`} tone="neutral" />
                <Metric label="Port. leverage" value={loading ? '—' : `${calc.portLev.toFixed(2)}x`} tone="neutral" />
                <Metric label="Eff. notional" value={loading ? '—' : `$${formatCompact(calc.nEff)}`} tone="neutral" />
              </div>

              {/* Correlations used. */}
              {calc.pairs.length > 0 && (
                <div>
                  <div className="t-caption uppercase tracking-wider mb-1.5">Correlations used (live)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {calc.pairs.map((pr) => (
                      <span key={pr.label} className="inline-flex items-center gap-1 rounded-[var(--radius-xs)] bg-[rgb(var(--p-inset))] border border-[var(--role-line)] px-1.5 py-0.5 text-[11px] font-mono text-[var(--role-content-muted)]">
                        {pr.label} <span className="text-[var(--role-content)] font-semibold">{pr.rho.toFixed(2)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--role-content-subtle)]">Add a position to see the netting.</div>
          )}
        </div>
      </div>

      <p className="t-caption px-4 lg:px-5 pb-4 leading-relaxed border-t border-[var(--role-line)] pt-3">
        Implements BULK&apos;s published portfolio-margin calculator: live correlation matrix, risk-surface
        maintenance rates, and regime time-decay (λ = mmrE + (mmrO−mmrE)·p^t). &quot;Live&quot; uses the current
        time-in-regime; &quot;Strict&quot; shows the worst case the instant a regime kicks in.
      </p>
    </div>
  );
}

function CompareBar({ label, sub, value, widthPct, barClass, highlight }: { label: string; sub: string; value: number; widthPct: number; barClass: string; highlight?: boolean; }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className={cn('text-xs font-medium', highlight ? 'text-[var(--pos)]' : 'text-[var(--role-content-muted)]')}>{label}</span>
          <span className="t-caption truncate">{sub}</span>
        </div>
        <span className={cn('font-mono font-semibold text-sm tabular-nums', highlight ? 'text-[var(--pos)]' : 'text-[var(--role-content)]')}>${formatNumber(value, 0)}</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-[rgb(var(--p-inset))] overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-300', barClass)} style={{ width: `${Math.max(2, Math.min(100, widthPct * 100))}%` }} />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'green' | 'neutral'; }) {
  return (
    <div className="bg-[rgb(var(--p-inset))] border border-[var(--role-line)] rounded-[var(--radius-md)] p-2.5 text-center">
      <div className="text-[9px] uppercase tracking-wider text-[var(--role-content-subtle)] mb-1">{label}</div>
      <div className={cn('font-mono font-bold tabular-nums text-sm', tone === 'green' ? 'text-[var(--pos)]' : 'text-[var(--role-content)]')}>{value}</div>
    </div>
  );
}
