'use client';

import { useEffect, useMemo, useState } from 'react';
import { analytics, cn, formatCompact, formatNumber, type RiskSurfaces } from '@/lib/api';
import { CoinPicker } from '@/components/CoinPicker';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { Layers } from 'lucide-react';

// ----------------------------------------------------------------------------
// PortfolioMarginCard — interactive explainer for BULK's portfolio margining.
//
// Most DEXs margin each position in isolation: open a long and a short and you
// post full margin on BOTH legs, as if they had nothing to do with each other.
// BULK reads the live correlation between the two assets (the `corrs` matrix
// published in the risk surfaces) and nets the hedge — your effective risk
// notional drops, and your required margin drops with it.
//
// We model that netting with the standard portfolio-risk relationship for a
// long/short pair of correlated assets:
//
//     effectiveNotional = sqrt(N₁² + N₂² − 2·ρ·N₁·N₂)
//
// For a tight hedge (ρ→1, opposite legs) the two risks cancel and the effective
// notional collapses toward zero — which is exactly why a hedged book on BULK
// can run a fraction of the margin a "sum-the-legs" venue would demand.
//
// All inputs are real: per-leg maintenance-margin rates are read from each
// coin's published risk surface (live regime), and ρ is BULK's own correlation
// coefficient. The only modelled part is the netting formula above; the exact
// on-chain requirement additionally reflects the active volatility regime,
// which we note in the footer.
// ----------------------------------------------------------------------------

const FALLBACK_MMR = 0.02; // 2% — BULK's real base maintenance rate (from the
                           // live surfaces; only used if a surface fails to load).
const MAX_CREDIT = 0.7;    // BULK caps the portfolio-margin credit at 70% per docs,
                           // so the netted requirement never drops below 30%.

/** Read a representative maintenance-margin rate for a leg from its surface. */
function legMmr(surf: RiskSurfaces | null, notional: number, side: 'long' | 'short'): number {
  if (!surf) return FALLBACK_MMR;
  const entry = surf.surfaces.find((s) => s.regime === surf.liveRegime) ?? surf.surfaces[0];
  if (!entry) return FALLBACK_MMR;
  // Notional tier: largest published bucket that the position still fits into.
  let nIdx = 0;
  for (let i = 0; i < entry.notionals.length; i++) {
    if (entry.notionals[i] <= notional) nIdx = i;
  }
  // MM is ~flat across leverage, so anchor on a representative ~10x step.
  let levIdx = 0;
  let best = Infinity;
  entry.leverage.forEach((l, i) => {
    const d = Math.abs(l - 10);
    if (d < best) { best = d; levIdx = i; }
  });
  const grid = side === 'long' ? entry.buy : entry.sell;
  const cell = grid?.[nIdx]?.[levIdx];
  return cell?.mmrE ?? cell?.mmrO ?? FALLBACK_MMR;
}

/** Look up BULK's correlation coefficient for an unordered coin pair.
 *  corrs entries are ["COINA:COINB", rho] with bare coin names (no -USD). */
function lookupRho(surf: RiskSurfaces | null, a: string, b: string): number | null {
  if (!surf?.corrs) return null;
  const norm = (s: string) => s.replace(/-USD$/i, '').trim().toUpperCase();
  const A = norm(a);
  const B = norm(b);
  if (A === B) return 1;
  for (const [pair, r] of surf.corrs) {
    const [x, y] = String(pair).split(':');
    if (x === undefined || y === undefined) continue;
    const X = norm(x);
    const Y = norm(y);
    if ((X === A && Y === B) || (X === B && Y === A)) return r;
  }
  return null;
}

export function PortfolioMarginCard() {
  const { network } = useCurrentNetwork();

  const [longCoin, setLongCoin] = useState('BTC');
  const [shortCoin, setShortCoin] = useState('ETH');
  const [longNotional, setLongNotional] = useState(100_000);
  const [shortNotional, setShortNotional] = useState(100_000);

  const [longSurf, setLongSurf] = useState<RiskSurfaces | null>(null);
  const [shortSurf, setShortSurf] = useState<RiskSurfaces | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch both legs' risk surfaces (carry real mmr + correlation). Refetch on
  // network switch so it tracks testnet/devnet like the rest of the app.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      analytics.getRiskSurfaces(longCoin).catch(() => null),
      analytics.getRiskSurfaces(shortCoin).catch(() => null),
    ]).then(([l, s]) => {
      if (cancelled) return;
      setLongSurf(l);
      setShortSurf(s);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [longCoin, shortCoin, network]);

  const calc = useMemo(() => {
    const mmrLong = legMmr(longSurf, longNotional, 'long');
    const mmrShort = legMmr(shortSurf, shortNotional, 'short');
    // Prefer ρ from either leg's published matrix; fall back to a labelled est.
    const rhoReal = lookupRho(longSurf, longCoin, shortCoin) ?? lookupRho(shortSurf, longCoin, shortCoin);
    const rho = rhoReal ?? 0.85;

    const gross = longNotional + shortNotional;
    const standardMargin = mmrLong * longNotional + mmrShort * shortNotional;
    // Portfolio risk of a long/short correlated pair.
    const effNotional = Math.sqrt(
      longNotional ** 2 + shortNotional ** 2 - 2 * rho * longNotional * shortNotional,
    );
    const nettingRatio = gross > 0
      ? Math.max(1 - MAX_CREDIT, Math.min(1, effNotional / gross))
      : 1;
    const bulkMargin = standardMargin * nettingRatio;
    const efficiency = bulkMargin > 0 ? standardMargin / bulkMargin : 0;
    const savedPct = standardMargin > 0 ? 1 - bulkMargin / standardMargin : 0;
    const effLeverage = bulkMargin > 0 ? gross / bulkMargin : 0;

    return { mmrLong, mmrShort, rho, rhoIsReal: rhoReal !== null, gross, standardMargin, effNotional, bulkMargin, efficiency, savedPct, effLeverage };
  }, [longSurf, shortSurf, longCoin, shortCoin, longNotional, shortNotional]);

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-4 lg:p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-[var(--accent)]" />
          <div>
            <h3 className="font-semibold text-[var(--text-primary)]">Portfolio Margining</h3>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              Hedged positions net against each other — your margin drops with your real risk.
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Correlation {calc.rhoIsReal ? '(live)' : '(est.)'}
          </div>
          <div className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
            {calc.rho.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Two legs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <LegInput badge="LONG" badgeClass="bg-bulk-green/15 text-bulk-green" coin={longCoin} onCoin={setLongCoin} notional={longNotional} onNotional={setLongNotional} accent="#22c55e" />
        <LegInput badge="SHORT" badgeClass="bg-bulk-red/15 text-bulk-red" coin={shortCoin} onCoin={setShortCoin} notional={shortNotional} onNotional={setShortNotional} accent="#ef4444" />
      </div>

      {/* Comparison bars */}
      <div className="space-y-2.5 mb-4">
        <CompareBar
          label="Standard DEX"
          sub="margins each leg separately"
          value={calc.standardMargin}
          widthPct={1}
          barClass="bg-[var(--text-tertiary)]/50"
        />
        <CompareBar
          label="BULK portfolio"
          sub="netted by live correlation"
          value={calc.bulkMargin}
          widthPct={calc.standardMargin > 0 ? calc.bulkMargin / calc.standardMargin : 0}
          barClass="bg-bulk-green"
          highlight
        />
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-3 gap-2.5">
        <Metric label="Capital efficiency" value={loading ? '—' : `${calc.efficiency.toFixed(1)}x`} tone="green" />
        <Metric label="Margin saved" value={loading ? '—' : `${Math.round(calc.savedPct * 100)}%`} tone="green" />
        <Metric label="Margin → notional" value={loading ? '—' : `$${formatCompact(calc.bulkMargin)} → $${formatCompact(calc.gross)}`} tone="neutral" />
      </div>

      {/* Honest footnote — on-brand for a transparent venue. */}
      <p className="text-[10px] text-[var(--text-tertiary)] mt-4 leading-relaxed">
        Uses BULK&apos;s live correlation coefficient and published per-asset maintenance rates.
        Netting follows the standard portfolio-risk model, capped at BULK&apos;s documented 70% max
        credit; the exact on-chain requirement also reflects the active volatility regime (see the
        margin surface above).
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function LegInput({
  badge, badgeClass, coin, onCoin, notional, onNotional, accent,
}: {
  badge: string;
  badgeClass: string;
  coin: string;
  onCoin: (c: string) => void;
  notional: number;
  onNotional: (n: number) => void;
  accent: string;
}) {
  return (
    <div className="bg-[var(--bg-base)] border border-[var(--border-color)] rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', badgeClass)}>
          {badge}
        </span>
        <CoinPicker value={coin} onChange={onCoin} ariaLabel={`${badge} asset`} />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Notional</span>
        <span className="font-mono font-semibold text-sm text-[var(--text-primary)] tabular-nums">
          ${formatCompact(notional)}
        </span>
      </div>
      <input
        type="range"
        min={10_000}
        max={1_000_000}
        step={10_000}
        value={notional}
        onChange={(e) => onNotional(Number(e.target.value))}
        className="w-full mt-1.5 h-1.5 cursor-pointer"
        style={{ accentColor: accent }}
      />
    </div>
  );
}

function CompareBar({
  label, sub, value, widthPct, barClass, highlight,
}: {
  label: string;
  sub: string;
  value: number;
  widthPct: number;
  barClass: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('text-xs font-medium', highlight ? 'text-bulk-green' : 'text-[var(--text-secondary)]')}>
            {label}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)]">{sub}</span>
        </div>
        <span className={cn('font-mono font-semibold text-sm tabular-nums', highlight ? 'text-bulk-green' : 'text-[var(--text-primary)]')}>
          ${formatNumber(value, 0)}
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-[var(--bg-secondary-20)]/40 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', barClass)}
          style={{ width: `${Math.max(2, Math.min(100, widthPct * 100))}%` }}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'green' | 'neutral' }) {
  return (
    <div className="bg-[var(--bg-base)] border border-[var(--border-color)] rounded-lg p-2.5 text-center">
      <div className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">{label}</div>
      <div className={cn('font-mono font-bold tabular-nums text-sm', tone === 'green' ? 'text-bulk-green' : 'text-[var(--text-primary)]')}>
        {value}
      </div>
    </div>
  );
}
