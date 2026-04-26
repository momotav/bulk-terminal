'use client';

import { useEffect, useMemo, useState } from 'react';
import { analytics, cn, type RiskSurfaces, type RiskSurfaceEntry } from '@/lib/api';
import { CoinPicker } from '@/components/CoinPicker';
import { Activity } from 'lucide-react';

// ----------------------------------------------------------------------------
// MarginSurface — heatmap of BULK's published maintenance-margin model.
//
// One cell per (notional bucket, leverage step). Color intensity reflects the
// `mmrO` value (opening maintenance margin) — most cells sit at the baseline
// (e.g. 2%) while a "hump" of higher values appears in the medium-leverage /
// large-size zone where BULK applies a static MM buffer to absorb slippage
// during slow-burn liquidations.
//
// Interaction: pick a coin, pick a regime, toggle Long/Short. Hover any cell
// for the exact (mmrO, mmrE, p) values plus the size/leverage it represents.
//
// The component handles its own loading/error state since each coin has its
// own ~500KB payload — we don't want a single cache-miss to block the rest
// of the Risk page from rendering.
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

// ----------------------------------------------------------------------------
// Color scale for cell rendering.
//
// The data is heavily skewed — most cells are at the baseline mmrO (e.g. 2%)
// with a sparse "hump" of values up to ~10%. A linear scale would compress
// the variation to invisibility. We use a square-root scale so small lifts
// above baseline are visually noticeable but extreme values still stand out.
//
// Color ramp: dark green (low MM%, "loose") → orange → red (high MM%, "tight").
// Picked to match the rest of the Risk page's regime gradient.
// ----------------------------------------------------------------------------
function cellColor(mmrO: number, baseline: number, maxMmr: number): string {
  if (maxMmr <= baseline) {
    // No variation in the surface — everything at baseline. Show as flat green.
    return 'rgb(0, 180, 130)';
  }
  // Map mmrO into [0, 1] using sqrt scaling so the small variations near the
  // baseline get visual range.
  const t = Math.sqrt(Math.max(0, (mmrO - baseline) / (maxMmr - baseline)));
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
}

export function MarginSurface() {
  const [coin, setCoin] = useState('BTC');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');

  const [data, setData] = useState<RiskSurfaces | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected regime for display. Initialized to liveRegime once data lands.
  const [regime, setRegime] = useState<number | null>(null);

  // Hovered cell for the readout below the heatmap. We use a footer readout
  // rather than a floating tooltip because the grid is 50×21 — floating
  // tooltips would clip on edge cells and feel jittery on hover.
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

  // Find the surface for the currently-selected regime. The available
  // regimes come from the data itself (BULK doesn't always populate all 25
  // possible values).
  const surface: RiskSurfaceEntry | null = useMemo(() => {
    if (!data || regime === null) return null;
    return data.surfaces.find((s) => s.regime === regime) || null;
  }, [data, regime]);

  // Compute color-scale bounds from the active surface. baseline = the most
  // common (modal) value; maxMmr = the largest. Using mode rather than min
  // keeps the bulk of cells at "loose green" instead of fading them toward
  // white near the lowest cell value.
  const { baseline, maxMmr } = useMemo(() => {
    if (!surface) return { baseline: 0.02, maxMmr: 0.02 };
    const grid = surface[side];
    let max = 0;
    let mode = 0.02;
    const counts = new Map<number, number>();
    for (const row of grid) {
      for (const cell of row) {
        if (cell.mmrO > max) max = cell.mmrO;
        const c = (counts.get(cell.mmrO) || 0) + 1;
        counts.set(cell.mmrO, c);
      }
    }
    let bestCount = 0;
    for (const [v, c] of counts.entries()) {
      if (c > bestCount) {
        bestCount = c;
        mode = v;
      }
    }
    return { baseline: mode, maxMmr: max };
  }, [surface, side]);

  // The set of regimes BULK actually populated for this coin. Sorted so the
  // dropdown reads naturally from "crash" to "melt-up".
  const availableRegimes: number[] = useMemo(
    () => (data ? data.surfaces.map((s) => s.regime).sort((a, b) => a - b) : []),
    [data]
  );

  return (
    <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
      {/* Header: title left, regime + side selectors on the right. */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] whitespace-nowrap">Margin Surface</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          {/* Regime dropdown — uses native select for compactness; the page
              already has too many <CoinPicker>-style dropdowns. */}
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
      ) : !surface ? (
        <div className="h-[280px] flex items-center justify-center text-[var(--text-tertiary)]">
          No surface available for regime {regime}.
        </div>
      ) : (
        <Heatmap
          surface={surface}
          side={side}
          baseline={baseline}
          maxMmr={maxMmr}
          onHover={setHover}
        />
      )}

      {/* Footer readout — single-line, professional. Original version used
          abbreviated jargon ("MM open", "existing", "portfolio factor") which
          made it hard to scan. Cleaned up to read naturally while keeping
          everything a power user might want.
          Format: "BTC long · $15M at 28x → 2.00% maintenance margin ($300K)"
          We always reserve the same vertical space to avoid reflow on hover. */}
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
              {(hover.mmrO * 100).toFixed(2)}%
            </span>
            {' maintenance margin '}
            <span className="font-mono">
              ({formatNotional(hover.notional * hover.mmrO)})
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
    </div>
  );
}

// ----------------------------------------------------------------------------
// Heatmap — pure render component. Kept separate so the parent's effect /
// state logic doesn't muddy the layout code. Receives a single surface +
// side and renders the 2D grid.
// ----------------------------------------------------------------------------
function Heatmap({
  surface,
  side,
  baseline,
  maxMmr,
  onHover,
}: {
  surface: RiskSurfaceEntry;
  side: 'buy' | 'sell';
  baseline: number;
  maxMmr: number;
  onHover: (h: HoveredCell | null) => void;
}) {
  const grid = surface[side]; // shape: notionals[i] × leverage[j]
  const { leverage, notionals } = surface;

  // Pick a sparse set of axis ticks to label — labelling all 50 leverages or
  // 21 notionals is too dense, so we show every Nth.
  const leverageTickStep = Math.max(1, Math.floor(leverage.length / 8));
  const notionalTickStep = Math.max(1, Math.floor(notionals.length / 6));

  return (
    <div
      className="w-full"
      onMouseLeave={() => onHover(null)}
    >
      {/* Top legend: leverage labels along X axis. */}
      <div
        className="grid mb-1 text-[10px] text-[var(--text-tertiary)]"
        style={{
          gridTemplateColumns: `52px repeat(${leverage.length}, minmax(0, 1fr))`,
        }}
      >
        <div /> {/* spacer aligned with notional column */}
        {leverage.map((lev, j) => (
          <div key={j} className="text-center truncate">
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
            {grid[i].map((cell, j) => (
              <div
                key={j}
                className="aspect-square min-h-[10px] cursor-default transition-[filter] hover:brightness-125"
                style={{ backgroundColor: cellColor(cell.mmrO, baseline, maxMmr) }}
                onMouseEnter={() =>
                  onHover({
                    notional,
                    leverage: leverage[j],
                    mmrO: cell.mmrO,
                    mmrE: cell.mmrE,
                    p: cell.p,
                  })
                }
              />
            ))}
          </div>
        ))}
      </div>

      {/* Axis title for X (leverage). Y is implied by the leftmost column
          which already has dollar values. */}
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
