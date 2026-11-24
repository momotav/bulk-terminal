'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MarginStressTest } from '@/components/MarginStressTest';
import { InfoTip } from '@/components/InfoTip';
import { analytics, cn, formatCompact, formatNumber, type RiskSurfaces } from '@/lib/api';
import { CoinPick } from '@/components/basket/tools/CoinPick';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { ChevronDown, Plus, X } from 'lucide-react';
import { normCoin as norm, portfolioMargin, type Side } from '@/lib/portfolioMargin';

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

interface Position { id: number; asset: string; side: Side; notional: number; }

const REGIMES: { id: number; label: string }[] = [
  { id: -12, label: 'Bear / High' }, { id: -11, label: 'Bear / Med' }, { id: -10, label: 'Bear / Low' },
  { id: 0, label: 'Neutral / Low' }, { id: 1, label: 'Neutral / Med' }, { id: 2, label: 'Neutral / High' },
  { id: 10, label: 'Bull / Low' }, { id: 11, label: 'Bull / Med' }, { id: 12, label: 'Bull / High' },
];

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

  const calc = useMemo(() => {
    const r = portfolioMargin(positions, { collateral, surfaces, regimeDts, regime: regimeSel, strict: mode === 'strict' });
    return r && { ...r, pairs: r.pairs.map((p) => ({ label: `${p.a} / ${p.b}`, rho: p.rho })) };
  }, [positions, collateral, regimeSel, mode, surfaces, regimeDts]);

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
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 lg:px-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[17px] font-medium text-[var(--role-content)]">
            Portfolio margining
            <InfoTip label="How this is calculated" width={340}>
              Implements BULK&apos;s published portfolio-margin calculator: live correlation matrix, risk-surface maintenance rates,
              and regime time-decay (λ = mmrE + (mmrO−mmrE)·p^t). &quot;Live&quot; uses the current time-in-regime; &quot;Strict&quot; shows the
              worst case the instant a regime kicks in.
            </InfoTip>
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--role-content-muted)]">Build a book: BULK nets correlated legs and the requirement drops.</p>
        </div>
        <Segment value={mode} onChange={setMode} options={[['live', 'Live'], ['strict', 'Strict']]} />
      </div>

      <div className="grid grid-cols-1 gap-5 p-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:p-5">
        {/* ── builder ── */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] text-[var(--role-content-muted)]">Collateral</span>
              <div className="mt-1 flex h-10 items-center gap-1 rounded-xl border border-[var(--role-line)] bg-[rgb(var(--p-inset))] px-3 focus-within:border-[var(--role-content-subtle)]">
                <span className="text-[13px] text-[var(--role-content-subtle)]">$</span>
                <input type="text" inputMode="decimal" value={collateral.toLocaleString('en-US')}
                  onChange={(e) => setCollateral(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
                  className="w-full min-w-0 bg-transparent text-[14px] tabular-nums text-[var(--role-content)] outline-none" />
              </div>
            </label>
            <div>
              <span className="text-[12px] text-[var(--role-content-muted)]">Regime</span>
              <RegimePick value={regimeSel} onChange={setRegimeSel} live={aggRegime} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-[12px] text-[var(--role-content-muted)]">
              <span>Positions</span><span>{positions.length} {positions.length === 1 ? 'leg' : 'legs'}</span>
            </div>
            <div className="space-y-2">
              {positions.map((p) => (
                <div key={p.id} className="rounded-xl border border-[var(--role-line)] bg-[rgb(var(--p-inset))] px-3 pb-2.5 pt-2.5 transition-colors hover:border-[var(--role-content-subtle)]">
                  <div className="flex items-center gap-2">
                    <CoinPick value={norm(p.asset)} onChange={(c) => update(p.id, { asset: c })} />
                    <Segment value={p.side} onChange={(v) => update(p.id, { side: v })} options={[['long', 'Long'], ['short', 'Short']]} tone />
                    <div className="ml-auto flex h-8 w-[120px] items-center gap-1 rounded-lg border border-[var(--role-line)] bg-[var(--role-surface)] px-2">
                      <span className="text-[12px] text-[var(--role-content-subtle)]">$</span>
                      <input type="text" inputMode="decimal" value={p.notional.toLocaleString('en-US')}
                        onChange={(e) => update(p.id, { notional: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
                        className="w-full min-w-0 bg-transparent text-right text-[13px] tabular-nums text-[var(--role-content)] outline-none" aria-label="Position size" />
                    </div>
                    <button onClick={() => removePos(p.id)} disabled={positions.length < 2} className="rounded-md p-1 text-[var(--role-content-subtle)] transition-colors hover:text-[var(--neg)] disabled:opacity-30" aria-label="Remove position"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <input type="range" min={10_000} max={1_000_000} step={10_000} aria-label="Position size"
                    value={Math.min(1_000_000, Math.max(10_000, p.notional))}
                    onChange={(e) => update(p.id, { notional: Number(e.target.value) })}
                    className="mt-2.5 h-1 w-full cursor-pointer" style={{ accentColor: p.side === 'long' ? 'var(--pos)' : 'var(--neg)' }} />
                </div>
              ))}
              <button onClick={addPos} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--role-line)] py-2 text-[12px] text-[var(--role-content-muted)] transition-colors hover:border-[var(--role-content-subtle)] hover:text-[var(--role-content)]">
                <Plus className="h-3.5 w-3.5" /> Add position
              </button>
            </div>
          </div>
        </div>

        {/* ── result ── */}
        <div className="flex flex-col gap-4">
          {calc ? (
            <>
              <div className="rounded-2xl border border-[var(--role-line)] bg-[rgb(var(--p-inset))] p-4">
                <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--role-content-muted)]">
                  <span>Capital freed by netting</span>
                  {calc.hedgeDiscount > 0 && <span className="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--pos)]" style={{ background: 'color-mix(in srgb, var(--pos) 14%, transparent)' }}>−{calc.hedgeDiscount.toFixed(1)}% margin</span>}
                </div>
                <div className="mt-1.5 text-[34px] font-medium leading-none tabular-nums text-[var(--pos)]">{loading ? '—' : `$${formatNumber(capitalFreed, 0)}`}</div>
                <div className="mt-2 text-[12px] text-[var(--role-content-muted)]">vs margining each leg on its own{loading ? '' : ` · ${calc.efficiency.toFixed(1)}× more capital-efficient`}</div>
              </div>

              <div className="space-y-3">
                <CompareBar label="Each leg on its own" value={calc.sumM} widthPct={1} color="var(--role-content-subtle)" />
                <CompareBar label="BULK portfolio margin" value={calc.mp} widthPct={calc.sumM > 0 ? calc.mp / calc.sumM : 0} color="var(--pos)" highlight />
              </div>

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--role-line)] bg-[var(--role-line)] sm:grid-cols-4">
                <Metric label="Efficiency" value={loading ? '—' : `${calc.efficiency.toFixed(1)}×`} accent />
                <Metric label="Margin usage" value={loading ? '—' : `${(calc.marginUsage * 100).toFixed(1)}%`} />
                <Metric label="Portfolio leverage" value={loading ? '—' : `${calc.portLev.toFixed(2)}×`} />
                <Metric label="Effective notional" value={loading ? '—' : `$${formatCompact(calc.nEff)}`} />
              </div>

              {calc.pairs.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="mr-1 text-[var(--role-content-muted)]">Correlations (live)</span>
                  {calc.pairs.map((pr) => (
                    <span key={pr.label} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--role-line)] px-2.5 py-0.5 text-[var(--role-content-muted)]">
                      {pr.label}<span className="font-medium tabular-nums text-[var(--role-content)]">{pr.rho.toFixed(2)}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--role-content-subtle)]">Add a position to see the netting.</div>
          )}
        </div>
      </div>

      <MarginStressTest positions={positions} collateral={collateral} surfaces={surfaces} regimeDts={regimeDts} regime={regimeSel} strict={mode === 'strict'} />
    </div>
  );
}

function Segment<T extends string>({ value, onChange, options, tone }: { value: T; onChange: (v: T) => void; options: [T, string][]; tone?: boolean }) {
  return (
    <div className="flex shrink-0 rounded-lg bg-[var(--role-surface)] p-0.5">
      {options.map(([v, l]) => {
        const on = value === v;
        const color = tone ? (v === 'long' ? 'var(--pos)' : 'var(--neg)') : 'var(--role-content)';
        return (
          <button key={v} type="button" onClick={() => onChange(v)}
            className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors', on ? 'shadow-sm' : 'text-[var(--role-content-subtle)] hover:text-[var(--role-content)]')}
            style={on ? { color, background: tone ? `color-mix(in srgb, ${color} 16%, transparent)` : 'rgb(var(--p-inset))' } : undefined}>{l}</button>
        );
      })}
    </div>
  );
}

function RegimePick({ value, onChange, live }: { value: number | 'live'; onChange: (v: number | 'live') => void; live: number | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  const liveLabel = `Live${live !== null ? ` (${live >= 0 ? '+' : ''}${Math.round(live)})` : ''}`;
  const label = value === 'live' ? liveLabel : `${value} · ${REGIMES.find((r) => r.id === value)?.label ?? ''}`;
  return (
    <div ref={ref} className="relative mt-1">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between rounded-xl border border-[var(--role-line)] bg-[rgb(var(--p-inset))] px-3 text-[14px] text-[var(--role-content)] transition-colors hover:border-[var(--role-content-subtle)]">
        <span className="truncate">{label}</span><ChevronDown className={cn('h-4 w-4 text-[var(--role-content-subtle)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="glass-pop absolute left-0 right-0 top-full z-30 mt-1 max-h-[280px] overflow-y-auto rounded-xl border border-[var(--role-line)] bg-[var(--bg-muted)] p-1 shadow-2xl">
          {[{ id: 'live' as const, label: liveLabel }, ...REGIMES.map((r) => ({ id: r.id, label: `${r.id} · ${r.label}` }))].map((r) => (
            <button key={String(r.id)} type="button" onClick={() => { onChange(r.id); setOpen(false); }}
              className={cn('w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--bg-base)]', value === r.id ? 'text-[var(--role-content)]' : 'text-[var(--role-content-muted)]')}>{r.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function CompareBar({ label, value, widthPct, color, highlight }: { label: string; value: number; widthPct: number; color: string; highlight?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span style={{ color: highlight ? 'var(--pos)' : 'var(--role-content-muted)' }}>{label}</span>
        <span className="font-medium tabular-nums" style={{ color: highlight ? 'var(--pos)' : 'var(--role-content)' }}>${formatNumber(value, 0)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[rgb(var(--p-inset))]">
        <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(2, Math.min(100, widthPct * 100))}%`, background: color, opacity: highlight ? 0.9 : 0.5 }} />
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-[var(--role-surface)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--role-content-muted)]">{label}</div>
      <div className="mt-0.5 text-[16px] font-medium tabular-nums" style={{ color: accent ? 'var(--pos)' : 'var(--role-content)' }}>{value}</div>
    </div>
  );
}
