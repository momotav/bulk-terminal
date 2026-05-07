'use client';

import { useEffect, useMemo, useState } from 'react';
import { analytics, cn, type RiskSurfaces, type RiskSurfaceEntry } from '@/lib/api';
import { CoinPicker } from '@/components/CoinPicker';
import { Activity } from 'lucide-react';

// ----------------------------------------------------------------------------
// MarginSurface — heatmap of BULK's published maintenance-margin model.
//
// One cell per (notional bucket, leverage step). Each cell holds three values:
//   mmrO  — start-of-regime (strict) maintenance margin rate
//   mmrE  — equilibrium (long-run) maintenance margin rate
//   p     — decay factor per unit of regimeDt
//
// Per BULK's portfolio-margin docs the live margin a position is actually
// charged decays over time:
//
//      λ(t) = mmrE + (mmrO − mmrE) · p^t
//
// where t = regimeDt, the time elapsed since the current regime began (from
// the ticker stream). At t=0 (regime just kicked in) λ = mmrO; as t→∞
// λ → mmrE. We expose two viewing modes:
//
//   "Live"   — apply decay using the LIVE regimeDt. Reflects what BULK is
//              actually charging right now. Only meaningful when viewing the
//              live regime; for hypothetical regimes there's no elapsed time
//              so we fall back to strict in that case (clearly indicated).
//   "Strict" — show mmrO unchanged. Useful for understanding the worst-case
//              margin requirement at the moment a regime first kicks in.
//
// Default is "Live" because that matches what users would see in BULK's own
// portfolio margin calculator.
// ----------------------------------------------------------------------------

const REGIME_LABELS: Record<number, string> = {
  [-12]: 'Crash',
  [-11]: 'Heavy stress',
  [-10]: 'Stress',
  [0]: 'Neutral',
  [10]: 'Rally',
  [11]: 'Heavy rally',
  [12]: 'Melt-up',
};

function regimeLabel(regime: number, isLive: boolean): string {
  const named = REGIME_LABELS[regime];
  const sign = regime > 0 ? '+' : '';
  const tag = named ? ` (${named})` : '';
  return `${sign}${regime}${tag}${isLive ? ' • LIVE' : ''}`;
}

// Format a notional in compact USD form. We re-implement instead of using
// formatCompact() so the rendered axis labels are tight (e.g. "$50K", "$10M").
function formatNotional(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// Format an elapsed-seconds count (regimeDt) into a short human string.
// e.g. 45 → "45s", 240 → "4m", 4500 → "1h 15m", 90000 → "1d 1h"
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m - h * 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const rem = h - d * 24;
  return rem ? `${d}d ${rem}h` : `${d}d`;
}

// ----------------------------------------------------------------------------
// Time-decay helper
//
// Implements λ(t) = mmrE + (mmrO − mmrE) · p^t, the formula BULK uses in its
// own portfolio margin calculator. With t=0 this collapses to mmrO; with
// large t it approaches mmrE.
//
// Edge cases:
//   - If p is missing or <=0, fall back to mmrO so we never produce
//     nonsensical numbers from corrupted upstream data.
//   - If t is null (e.g. we don't have a regimeDt for this market), return
//     mmrO so the caller falls back to strict mode silently.
// ----------------------------------------------------------------------------
function decayedLambda(mmrO: number, mmrE: number, p: number, t: number | null): number {
  if (t === null || t < 0) return mmrO;
  if (!p || p <= 0 || p >= 1) return mmrO; // p must be in (0, 1) for decay to make sense
  const pdt = Math.pow(p, t);
  return mmrE + (mmrO - mmrE) * pdt;
}

// ----------------------------------------------------------------------------
// Color scale for cell rendering.
//
// The data is heavily skewed — most cells are at the baseline mmrO (e.g. 2%)
// with a sparse "hump" of values up to ~15%. A linear scale would compress
// the variation to invisibility. We use a square-root scale so small lifts
// above baseline are visually noticeable but extreme values still stand out.
//
// Color ramp: dark green (low MM%, "loose") → orange → red (high MM%, "tight").
// ----------------------------------------------------------------------------
function cellColor(value: number, baseline: number, maxMmr: number): string {
  if (maxMmr <= baseline) {
    // No variation in the surface — everything at baseline. Show as flat green.
    return 'rgb(0, 180, 130)';
  }
  // Map value into [0, 1] using sqrt scaling so small variations near the
  // baseline get visual range.
  const t = Math.sqrt(Math.max(0, Math.min(1, (value - baseline) / (maxMmr - baseline))));
  // Interpolate green → orange → red.
  if (t < 0.5) {
    // green → orange
    const u = t / 0.5;
    const r = Math.round(0 + (255 - 0) * u);
    const g = Math.round(180 + (165 - 180) * u);
    const b = Math.round(130 + (0 - 130) * u);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // orange → red
    const u = (t - 0.5) / 0.5;
    const r = Math.round(255 + (239 - 255) * u);
    const g = Math.round(165 + (74 - 165) * u);
    const b = Math.round(0 + (60 - 0) * u);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

interface HoveredCell {
  notional: number;
  leverage: number;
  mmrO: number;
  mmrE: number;
  p: number;
  // The effective lambda for this cell after decay (or just mmrO in strict
  // mode). Pre-computed by the parent so the readout can render without
  // re-running the decay formula.
  effective: number;
}

type ViewMode = 'live' | 'strict';

export function MarginSurface() {
  const [coin, setCoin] = useState('BTC');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [mode, setMode] = useState<ViewMode>('live');

  const [data, setData] = useState<RiskSurfaces | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected regime for display. Initialized to liveRegime once data lands.
  const [regime, setRegime] = useState<number | null>(null);

  // regimeDt for the currently-displayed coin, in seconds. Refreshed on a
  // 10-second interval to keep the live decay value moving without putting
  // the user's browser under load. null while loading.
  const [regimeDt, setRegimeDt] = useState<number | null>(null);

  const [hover, setHover] = useState<HoveredCell | null>(null);

  // Fetch surfaces whenever the user picks a different coin. Cache is on
  // the backend (5min) so coin-switching is fast for repeat visits.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    analytics
      .getRiskSurfaces(coin)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        // Default the regime selector to whatever's live right now.
        setRegime(res.liveRegime);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load risk surfaces for', coin, err);
        setError(err instanceof Error ? err.message : 'Failed to load risk surfaces');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coin]);

  // Poll regime data so regimeDt stays current. The /api/analytics/regime
  // endpoint returns regimeDt for every market in one shot; we filter to
  // the selected coin. 10s matches the granularity at which BULK reports
  // regimeDt in the ticker stream — polling faster wouldn't change anything.
  //
  // Note: the backend returns markets keyed by bare coin (e.g. "BTC"), not
  // the full symbol string ("BTC-USD"). We match against `coin` directly.
  useEffect(() => {
    let cancelled = false;

    const pull = () => {
      analytics
        .getRegimeData()
        .then((res) => {
          if (cancelled) return;
          // Backend stores symbol as bare coin ("BTC") today, but be
          // tolerant of either format in case that changes — match either
          // exact-coin or "<coin>-USD".
          const market = res.markets.find(
            (m) => m.symbol === coin || m.symbol === `${coin}-USD`
          );
          // regimeDt is documented as "regime duration in 10s intervals" in
          // some docs and as raw seconds in others. We treat it as seconds
          // here because the doc calculator uses it raw in `Math.pow(p, dt)`.
          setRegimeDt(market?.regimeDt ?? null);
        })
        .catch(() => {
          if (!cancelled) setRegimeDt(null);
        });
    };

    pull();
    const id = setInterval(pull, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [coin]);

  // Find the surface for the currently-selected regime. The available
  // regimes come from the data itself (BULK doesn't always populate all 25
  // possible values).
  const surface: RiskSurfaceEntry | null = useMemo(() => {
    if (!data || regime === null) return null;
    return data.surfaces.find((s) => s.regime === regime) || null;
  }, [data, regime]);

  // Whether we're currently viewing the live regime. Decay only makes sense
  // for the live regime — for hypothetical regimes there's no elapsed time.
  const isViewingLiveRegime = data !== null && regime !== null && regime === data.liveRegime;

  // Resolve the actual decay parameter to apply to cells. In strict mode,
  // or when viewing a non-live regime, we use null which makes
  // decayedLambda() return mmrO unchanged.
  const effectiveDt: number | null = useMemo(() => {
    if (mode !== 'live') return null;
    if (!isViewingLiveRegime) return null;
    return regimeDt;
  }, [mode, isViewingLiveRegime, regimeDt]);

  // Compute the effective grid (post-decay) so both the heatmap and the
  // bounds calculation share the same numbers. Memoized because the grid is
  // 21×50 = 1050 cells and we don't want to recompute on every hover.
  const effectiveGrid: number[][] | null = useMemo(() => {
    if (!surface) return null;
    const raw = surface[side];
    return raw.map((row) =>
      row.map((cell) => decayedLambda(cell.mmrO, cell.mmrE, cell.p, effectiveDt))
    );
  }, [surface, side, effectiveDt]);

  // Color-scale bounds derived from the effective grid. baseline = mode (most
  // common cell value); maxMmr = peak. Using mode rather than min keeps the
  // bulk of cells at "loose green" instead of fading them toward white near
  // the lowest cell value.
  const { baseline, maxMmr } = useMemo(() => {
    if (!effectiveGrid) return { baseline: 0.02, maxMmr: 0.02 };
    let max = 0;
    const counts = new Map<number, number>();
    for (const row of effectiveGrid) {
      for (const v of row) {
        if (v > max) max = v;
        // Round to 4 decimals before binning so floating-point noise doesn't
        // fragment the modal class. 0.0200001 and 0.02 should count together.
        const bin = Math.round(v * 10000) / 10000;
        counts.set(bin, (counts.get(bin) || 0) + 1);
      }
    }
    let bestCount = 0;
    let mode = 0.02;
    for (const [v, c] of counts.entries()) {
      if (c > bestCount) {
        bestCount = c;
        mode = v;
      }
    }
    return { baseline: mode, maxMmr: max };
  }, [effectiveGrid]);

  // The set of regimes BULK actually populated for this coin. Sorted so the
  // dropdown reads naturally from "crash" to "melt-up".
  const availableRegimes: number[] = useMemo(
    () => (data ? data.surfaces.map((s) => s.regime).sort((a, b) => a - b) : []),
    [data]
  );

  // Whether the live mode is currently being applied. False if user is on
  // strict mode OR if they've selected a non-live regime. Used to set the
  // toggle's disabled visual state and to drive the footer note.
  const liveDecayActive = mode === 'live' && isViewingLiveRegime && regimeDt !== null;

  return (
    <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
      {/* Header: title left, mode + side + regime selectors on the right. */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] whitespace-nowrap">Margin Surface</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Live / Strict toggle.
              "Live" applies time decay using the regime's elapsed seconds,
              matching what BULK actually charges right now. "Strict" shows
              the start-of-regime values — useful for understanding the
              worst-case requirement when a regime kicks in. */}
          <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5"
            title="Live applies the regime's time-decay; Strict shows start-of-regime values."
          >
            <button
              onClick={() => setMode('live')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                mode === 'live'
                  ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              Live
            </button>
            <button
              onClick={() => setMode('strict')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                mode === 'strict'
                  ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              Strict
            </button>
          </div>
          {/* Long / Short toggle */}
          <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
            <button
              onClick={() => setSide('buy')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                side === 'buy'
                  ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              Long
            </button>
            <button
              onClick={() => setSide('sell')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded transition-colors',
                side === 'sell'
                  ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              Short
            </button>
          </div>
          {/* Regime dropdown — uses native select for compactness. */}
          {data && availableRegimes.length > 0 && regime !== null && (
            <select
              value={regime}
              onChange={(e) => setRegime(Number(e.target.value))}
              className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)]"
            >
              {availableRegimes.map((r) => (
                <option key={r} value={r}>
                  {regimeLabel(r, r === data.liveRegime)}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Coin picker on its own row so the header stays single-line. */}
      <div className="mb-3">
        <CoinPicker value={coin} onChange={setCoin} ariaLabel="Coin for margin surface" />
      </div>

      {/* Heatmap body. */}
      {loading ? (
        <div className="h-[280px] flex items-center justify-center text-[var(--text-tertiary)]">
          Loading margin surface...
        </div>
      ) : error ? (
        <div className="h-[280px] flex items-center justify-center text-[var(--text-tertiary)]">
          {error}
        </div>
      ) : !surface || !effectiveGrid ? (
        <div className="h-[280px] flex items-center justify-center text-[var(--text-tertiary)]">
          No surface available for regime {regime}.
        </div>
      ) : (
        <Heatmap
          leverage={surface.leverage}
          notionals={surface.notionals}
          rawCells={surface[side]}
          effectiveGrid={effectiveGrid}
          baseline={baseline}
          maxMmr={maxMmr}
          onHover={setHover}
        />
      )}

      {/* Footer readout — single-line, professional.
          Format: "BTC long · $15M at 28x → 2.00% maintenance margin ($300K)"
          When in live mode AND viewing the live regime, we add a small
          context line below explaining how long the regime has been active. */}
      <div className="mt-3 text-xs text-[var(--text-secondary)] min-h-[20px]">
        {hover ? (
          <span>
            <span className="text-[var(--text-primary)] font-medium">{coin}</span>
            {' '}
            <span className="text-[var(--text-primary)]">{side === 'buy' ? 'long' : 'short'}</span>
            {' · '}
            <span className="font-mono text-[var(--text-primary)]">{formatNotional(hover.notional)}</span>
            {' at '}
            <span className="font-mono text-[var(--text-primary)]">{hover.leverage}x</span>
            {' → '}
            <span className="font-mono text-[var(--text-primary)]">
              {(hover.effective * 100).toFixed(2)}%
            </span>
            {' maintenance margin '}
            <span className="font-mono">
              ({formatNotional(hover.notional * hover.effective)})
            </span>
          </span>
        ) : surface ? (
          <span>
            Baseline <span className="font-mono text-[var(--text-primary)]">{(baseline * 100).toFixed(2)}%</span>
            {maxMmr > baseline && (
              <>
                {' · peak '}
                <span className="font-mono text-[var(--text-primary)]">{(maxMmr * 100).toFixed(2)}%</span>
                <span> at medium leverage on large positions</span>
              </>
            )}
          </span>
        ) : null}
      </div>

      {/* Mode context note. Only shown when there's something to clarify —
          if the user is on Live + live regime, a quiet "λ(t) = ..." footnote
          tells them the surface is live-decayed. If they're on Live but
          looking at a non-live regime, we explain that no decay is being
          applied (and thus their view matches Strict). If they're on Strict,
          stay quiet — nothing to clarify. */}
      {mode === 'live' && (
        <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
          {liveDecayActive ? (
            <>
              Live decay applied · regime active for{' '}
              <span className="font-mono">{formatDuration(regimeDt!)}</span> ·{' '}
              λ(t) = mmrE + (mmrO − mmrE) · p<sup>t</sup>
            </>
          ) : !isViewingLiveRegime ? (
            <>
              Showing start-of-regime values for hypothetical regime · live decay only applies to the live regime
            </>
          ) : (
            <>Live regime data unavailable · showing start-of-regime values</>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Heatmap — pure render component. Receives axis knots, the raw cells (for
// hover detail), and the pre-computed effective grid (post-decay) for color
// rendering. Keeping these as separate props avoids ambiguity about which
// side's data to use.
// ----------------------------------------------------------------------------
function Heatmap({
  leverage,
  notionals,
  rawCells,
  effectiveGrid,
  baseline,
  maxMmr,
  onHover,
}: {
  leverage: number[];
  notionals: number[];
  rawCells: { mmrO: number; mmrE: number; p: number }[][];
  effectiveGrid: number[][];
  baseline: number;
  maxMmr: number;
  onHover: (h: HoveredCell | null) => void;
}) {
  // Pick a sparse set of axis ticks to label — labelling all 50 leverages or
  // 21 notionals is too dense, so we show every Nth.
  // On mobile (≤640px), columns are ~12-15px wide which can't fit even
  // 2-digit labels. We can't easily detect viewport size during render
  // without hooks, so we just show fewer labels overall — every 4th or
  // 5th column instead of every 2nd. The previous step (length/8) gave
  // ~10 labels on a 20-leverage axis, way too many for mobile.
  // length/5 gives ~4 labels which is the sweet spot: enough to anchor
  // the user's understanding of the axis, sparse enough to never
  // collide with neighboring columns.
  const leverageTickStep = Math.max(1, Math.floor(leverage.length / 5));
  const notionalTickStep = Math.max(1, Math.floor(notionals.length / 6));

  return (
    <div className="w-full" onMouseLeave={() => onHover(null)}>
      {/* Top legend: leverage labels along X axis.
          We use `whitespace-nowrap` and `overflow-visible` instead of the
          old `truncate` so labels can spill into adjacent (empty) columns
          rather than getting cut off mid-character. With the sparser tick
          step above, every label has at least 4 empty columns of breathing
          room around it, so overflow never collides with another label. */}
      <div
        className="grid mb-1 text-[10px] text-[var(--text-tertiary)]"
        style={{
          gridTemplateColumns: `52px repeat(${leverage.length}, minmax(0, 1fr))`,
        }}
      >
        <div /> {/* spacer aligned with notional column */}
        {leverage.map((lev, j) => (
          <div key={j} className="text-center whitespace-nowrap overflow-visible">
            {j % leverageTickStep === 0 || j === leverage.length - 1 ? `${lev}x` : ''}
          </div>
        ))}
      </div>

      {/* Body: one row per notional bucket, plus a label column on the left. */}
      <div className="space-y-[1px]">
        {notionals.map((notional, i) => (
          <div
            key={i}
            className="grid items-stretch"
            style={{
              gridTemplateColumns: `52px repeat(${leverage.length}, minmax(0, 1fr))`,
              gap: '1px',
            }}
          >
            <div className="text-[10px] text-right pr-1 text-[var(--text-tertiary)] flex items-center justify-end">
              {i % notionalTickStep === 0 || i === notionals.length - 1 ? formatNotional(notional) : ''}
            </div>
            {effectiveGrid[i].map((effective, j) => {
              const raw = rawCells[i]?.[j];
              return (
                <div
                  key={j}
                  className="aspect-square min-h-[10px] cursor-default transition-[filter] hover:brightness-125"
                  style={{ backgroundColor: cellColor(effective, baseline, maxMmr) }}
                  onMouseEnter={() =>
                    onHover({
                      notional,
                      leverage: leverage[j],
                      mmrO: raw?.mmrO ?? effective,
                      mmrE: raw?.mmrE ?? effective,
                      p: raw?.p ?? 1,
                      effective,
                    })
                  }
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Axis title for X (leverage). */}
      <div className="text-[10px] text-[var(--text-tertiary)] text-center mt-1">
        Leverage →
      </div>

      {/* Color scale legend — small horizontal gradient with labeled endpoints. */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-[var(--text-tertiary)]">
        <span className="font-mono">{(baseline * 100).toFixed(2)}%</span>
        <div
          className="flex-1 h-2 rounded"
          style={{
            background:
              maxMmr <= baseline
                ? 'rgb(0, 180, 130)'
                : 'linear-gradient(to right, rgb(0, 180, 130), rgb(255, 165, 0), rgb(239, 74, 60))',
          }}
        />
        <span className="font-mono">{(maxMmr * 100).toFixed(2)}%</span>
      </div>
    </div>
  );
}
