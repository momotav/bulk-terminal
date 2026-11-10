// BULK's published portfolio-margin calculator (docs.bulk.trade), shared by the Risk
// page card and the basket. Same pipeline BULK documents, on the same live data:
//
//   1. signed notional      sN_i = sign_i · notional_i
//   2. effective notional   N_eff = √(Σ sN_i² + 2·Σ_{i<j} sN_i·sN_j·ρ_ij)
//   3. portfolio leverage   L = N_eff / collateral
//   4. lambda lookup        bilinear interp on the regime surface at (notional_i, L),
//                           with time decay λ(t) = mmrE + (mmrO − mmrE)·p^t, t = regimeDt
//   5. signed margin        M_i = sign_i · λ_i · notional_i
//   6. portfolio margin     M_p = √(Σ M_i² + 2·Σ_{i<j} M_i·M_j·ρ_ij)
//   7. hedge discount       (1 − M_p / Σ|M_i|) · 100

import type { RiskSurfaces } from '@/lib/api';

export type Side = 'long' | 'short';
export interface MarginLeg { asset: string; side: Side; notional: number }

export const FALLBACK_LAMBDA = 0.02; // BULK's surface floor, if a cell is missing.
export const FALLBACK_RHO = 0.75;
export const normCoin = (s: string) => s.replace(/-USD$/i, '').trim().toUpperCase();

/** λ(t) = mmrE + (mmrO − mmrE)·p^t: BULK's regime time-decay. t=0 ⇒ strict (mmrO). */
export function decayedLambda(mmrO: number, mmrE: number, p: number, t: number): number {
  if (t <= 0) return mmrO;
  if (!p || p <= 0 || p >= 1) return mmrO;
  return mmrE + (mmrO - mmrE) * Math.pow(p, t);
}

/** Bilinear-interpolated λ on a regime surface at (notional, leverage), with decay. */
export function lookupLambda(surf: RiskSurfaces | null, regime: number, notional: number, leverage: number, side: Side, dt: number): number {
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
export function lookupRho(corrs: RiskSurfaces['corrs'] | undefined, a: string, b: string): number | null {
  if (!corrs) return null;
  const A = normCoin(a); const B = normCoin(b);
  if (A === B) return 1;
  for (const [pair, r] of corrs) {
    const [x, y] = String(pair).split(':');
    if (x === undefined || y === undefined) continue;
    if ((normCoin(x) === A && normCoin(y) === B) || (normCoin(x) === B && normCoin(y) === A)) return r;
  }
  return null;
}

export interface PortfolioMarginResult {
  sumN: number; nEff: number; portLev: number;
  /** Margin if every leg were held on its own. */
  sumM: number;
  /** BULK's netted portfolio margin. */
  mp: number;
  hedgeDiscount: number; marginUsage: number; efficiency: number;
  pairs: { a: string; b: string; rho: number; known: boolean }[];
  rows: { asset: string; side: Side; notional: number; lambda: number; margin: number }[];
}

export function portfolioMargin(legs: MarginLeg[], opts: {
  collateral: number;
  surfaces: Record<string, RiskSurfaces | null>;
  regimeDts: Record<string, number>;
  /** 'live' = each market's live regime; a number forces that regime everywhere. */
  regime?: number | 'live';
  /** Strict ignores the time decay: the requirement the instant a regime starts. */
  strict?: boolean;
}): PortfolioMarginResult | null {
  const C = opts.collateral || 1;
  const pos = legs.filter((p) => p.notional > 0);
  if (!pos.length) return null;
  let corrs: RiskSurfaces['corrs'] | undefined;
  for (const s of Object.values(opts.surfaces)) if (s?.corrs?.length) { corrs = s.corrs; break; }

  const rhoKnown = (i: number, j: number) => lookupRho(corrs, pos[i].asset, pos[j].asset);
  const rho = (i: number, j: number) => rhoKnown(i, j) ?? FALLBACK_RHO;
  const sign = (p: MarginLeg) => (p.side === 'long' ? 1 : -1);

  const sN = pos.map((p) => sign(p) * p.notional);
  let nEffSq = 0;
  for (let i = 0; i < pos.length; i++) {
    nEffSq += sN[i] * sN[i];
    for (let j = i + 1; j < pos.length; j++) nEffSq += 2 * sN[i] * sN[j] * rho(i, j);
  }
  const nEff = Math.sqrt(Math.max(0, nEffSq));
  const portLev = nEff / C;

  const regime = opts.regime ?? 'live';
  const dtFor = (p: MarginLeg) => (opts.strict ? 0 : (opts.regimeDts[normCoin(p.asset)] ?? 0));
  const regimeFor = (p: MarginLeg) => (regime === 'live' ? (opts.surfaces[normCoin(p.asset)]?.liveRegime ?? 0) : regime);
  const lambdas = pos.map((p) => lookupLambda(opts.surfaces[normCoin(p.asset)] ?? null, regimeFor(p), p.notional, portLev, p.side, dtFor(p)));
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

  const pairs: PortfolioMarginResult['pairs'] = [];
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
    const k = rhoKnown(i, j);
    pairs.push({ a: normCoin(pos[i].asset), b: normCoin(pos[j].asset), rho: k ?? FALLBACK_RHO, known: k !== null });
  }
  const rows = pos.map((p, i) => ({ asset: normCoin(p.asset), side: p.side, notional: p.notional, lambda: lambdas[i], margin: Math.abs(M[i]) }));
  return { sumN, nEff, portLev, sumM, mp, hedgeDiscount, marginUsage: mp / C, efficiency: mp > 0 ? sumM / mp : 0, pairs, rows };
}
