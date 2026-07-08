'use client';

import { useState, useEffect, useMemo } from 'react';
import { analytics, formatCompact, cn } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Line, LineChart, Area, AreaChart, ReferenceLine
} from 'recharts';
import { TrendingUp, Activity, Gauge } from 'lucide-react';
import { CoinSelector } from '@/components/CoinSelector';
import { ResizableChartRow } from '@/components/ResizableChartRow';
import { ChartFrame } from '@/components/ChartFrame';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';
import { CoinPicker } from '@/components/CoinPicker';
import { MarginSurface } from '@/components/MarginSurface';
import { PortfolioMarginCard } from '@/components/PortfolioMarginCard';
import {
  DEFAULT_COINS,
  OTHER_KEY,
  getCoinColor,
  adaptLegacyRow,
} from '@/lib/coins';

// Legacy COLORS map kept for the non-coin entries (positive/negative/neutral
// used by regime indicators). All coin colors should come from getCoinColor()
// so BNB/DOGE/SUI/ZEC etc. render with proper distinct colors.
const COLORS = {
  BTC: 'var(--shade-2)',
  ETH: 'var(--shade-1)',
  SOL: 'var(--shade-4)',
  positive: '#00B482',
  negative: '#EF4A3C',
  neutral: 'var(--accent)',
};

// Regime labels based on value
const getRegimeLabel = (regime: number): { label: string; color: string } => {
  if (regime <= -8) return { label: 'Strong Bearish', color: '#EF4A3C' };
  if (regime <= -4) return { label: 'Bearish', color: '#F87171' };
  if (regime <= -1) return { label: 'Slightly Bearish', color: '#FBBF24' };
  if (regime === 0) return { label: 'Neutral', color: '#9CA3AF' };
  if (regime <= 3) return { label: 'Slightly Bullish', color: '#86EFAC' };
  if (regime <= 7) return { label: 'Bullish', color: '#4ADE80' };
  return { label: 'Strong Bullish', color: '#00B482' };
};

// Market Regime Gauge Component
const RegimeGauge = ({ value, symbol }: { value: number; symbol: string }) => {
  const { label, color } = getRegimeLabel(value);
  const percentage = ((value + 12) / 24) * 100;
  
  return (
    <div className="flex flex-col items-center p-4 bg-[var(--bg-muted)] rounded-lg">
      <p className="text-sm text-[var(--text-tertiary)] mb-2">{symbol}</p>
      <div className="relative w-32 h-16 overflow-hidden">
        <div className="absolute inset-0">
          <svg viewBox="0 0 100 50" className="w-full h-full">
            <defs>
              <linearGradient id={`gauge-gradient-${symbol}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#EF4A3C" />
                <stop offset="50%" stopColor="#FFB548" />
                <stop offset="100%" stopColor="#00B482" />
              </linearGradient>
            </defs>
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke="var(--border-color)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="M 10 50 A 40 40 0 0 1 90 50"
              fill="none"
              stroke={`url(#gauge-gradient-${symbol})`}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="126"
              strokeDashoffset={126 - (126 * percentage / 100)}
            />
          </svg>
        </div>
        <div 
          className="absolute bottom-0 left-1/2 w-1 h-12 origin-bottom transition-transform duration-500"
          style={{ 
            transform: `translateX(-50%) rotate(${(percentage - 50) * 1.8}deg)`,
            background: `linear-gradient(to top, ${color}, transparent)`
          }}
        />
      </div>
      <p className="text-lg font-bold mt-2" style={{ color }}>{value > 0 ? '+' : ''}{value}</p>
      <p className="text-xs text-[var(--text-tertiary)]">{label}</p>
    </div>
  );
};

// Heatmap Cell Component
const HeatmapCell = ({ value, label }: { value: number; label?: string }) => {
  // Value ranges from 0 to 1 for correlation
  // High (close to 1) = green, Low (close to 0) = red
  const getColor = (v: number) => {
    if (v >= 0.95) return 'bg-[#00B482]'; // Perfect correlation (self)
    if (v >= 0.85) return 'bg-[#00B482]/90';
    if (v >= 0.75) return 'bg-[#00B482]/70';
    if (v >= 0.65) return 'bg-[#4ADE80]/60';
    if (v >= 0.55) return 'bg-[#FFB548]/50';
    if (v >= 0.45) return 'bg-[#FB923C]/60';
    if (v >= 0.35) return 'bg-[#EF4A3C]/60';
    return 'bg-[#EF4A3C]/80'; // Low correlation
  };
  
  return (
    <div className={cn(
      "flex items-center justify-center p-3 rounded text-sm font-mono font-medium",
      getColor(value),
      value >= 0.9 ? "text-white" : "text-[var(--text-primary)]"
    )}>
      {label || (value >= 0 ? '+' : '')}{typeof value === 'number' ? value.toFixed(2) : value}
    </div>
  );
};

/**
 * CorrelationMatrix — N×N grid of correlation values across `assets`.
 *
 * When the number of coins is small (≤ DENSE_THRESHOLD) every cell shows its
 * numeric value inline, matching the legacy look. When the matrix gets larger
 * the text is hidden by default (cells keep their background color) and only
 * revealed on hover — mirroring common heatmap tooling like Grafana and
 * Hyperliquid's expanded correlation view. This prevents the matrix from
 * overflowing its container when the user enables many coins.
 */
const DENSE_THRESHOLD = 6;

function CorrelationMatrix({
  assets,
  matrix,
}: {
  assets: string[];
  matrix: number[][];
}) {
  const dense = assets.length > DENSE_THRESHOLD;
  // Hovered cell for the always-visible value readout under the matrix when
  // we're in dense mode. Null means no cell hovered.
  const [hover, setHover] = useState<{ row: string; col: string; value: number } | null>(null);

  // Returns the tailwind bg class for a correlation value. Kept identical to
  // HeatmapCell so the two panels stay visually consistent.
  const bgFor = (v: number): string => {
    if (v >= 0.95) return 'bg-[#00B482]';
    if (v >= 0.85) return 'bg-[#00B482]/90';
    if (v >= 0.75) return 'bg-[#00B482]/70';
    if (v >= 0.65) return 'bg-[#4ADE80]/60';
    if (v >= 0.55) return 'bg-[#FFB548]/50';
    if (v >= 0.45) return 'bg-[#FB923C]/60';
    if (v >= 0.35) return 'bg-[#EF4A3C]/60';
    return 'bg-[#EF4A3C]/80';
  };

  return (
    <div className="space-y-2">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `auto repeat(${assets.length}, minmax(0, 1fr))` }}
      >
        {/* Header row */}
        <div />
        {assets.map(asset => (
          <div
            key={`h-${asset}`}
            className="text-center text-[11px] text-[var(--text-tertiary)] py-1 truncate"
            title={asset}
          >
            {asset}
          </div>
        ))}

        {/* Data rows. Use a React fragment with a proper key instead of the
            old `<>…</>` which couldn't carry a key attribute (that was
            generating React warnings on the legacy implementation). */}
        {assets.map((rowAsset, i) => (
          <CorrelationRow
            key={`row-${rowAsset}`}
            rowAsset={rowAsset}
            row={matrix[i]}
            assets={assets}
            dense={dense}
            bgFor={bgFor}
            onHover={setHover}
          />
        ))}
      </div>

      {/* In dense mode we dedicate a small footer row that shows the hovered
          cell's exact value. Means the user doesn't need a floating tooltip
          to learn the value, which is simpler on mobile and keyboards. */}
      {dense && (
        <div className="text-xs text-[var(--text-tertiary)] text-center min-h-[18px]">
          {hover
            ? <span>
                <span className="text-[var(--text-primary)] font-medium">{hover.row}</span>
                {' ↔ '}
                <span className="text-[var(--text-primary)] font-medium">{hover.col}</span>
                {' → '}
                <span className="font-mono text-[var(--text-primary)]">
                  {hover.value >= 0 ? '+' : ''}{hover.value.toFixed(2)}
                </span>
              </span>
            : <span>Hover a cell to see its correlation value</span>}
        </div>
      )}
    </div>
  );
}

// One row of the matrix — its own component so the `assets.map(... <>...</>)`
// anti-pattern (fragments can't carry keys) is replaced with a proper
// keyable element. Tiny but keeps React's reconciler happy.
function CorrelationRow({
  rowAsset,
  row,
  assets,
  dense,
  bgFor,
  onHover,
}: {
  rowAsset: string;
  row: number[];
  assets: string[];
  dense: boolean;
  bgFor: (v: number) => string;
  onHover: (h: { row: string; col: string; value: number } | null) => void;
}) {
  return (
    <>
      <div className="text-[11px] text-[var(--text-tertiary)] flex items-center pr-2 truncate" title={rowAsset}>
        {rowAsset}
      </div>
      {row.map((val, j) => {
        const colAsset = assets[j];
        const classes = cn(
          'flex items-center justify-center rounded font-mono font-medium transition-colors',
          bgFor(val),
          val >= 0.9 ? 'text-white' : 'text-[var(--text-primary)]',
          // In dense mode cells are smaller and hide the text (revealed on hover).
          dense ? 'aspect-square text-[10px]' : 'p-3 text-sm'
        );
        return (
          <div
            key={`${rowAsset}-${colAsset}`}
            className={classes}
            onMouseEnter={() => onHover({ row: rowAsset, col: colAsset, value: val })}
            onMouseLeave={() => onHover(null)}
            title={dense ? `${rowAsset} ↔ ${colAsset}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}` : undefined}
          >
            {/* In dense mode the value is hidden unless the cell is hovered —
                matches common heatmap behavior and keeps the grid compact. */}
            {dense ? (
              <span className="opacity-0 hover:opacity-100 transition-opacity">
                {val >= 0 ? '+' : ''}{val.toFixed(2)}
              </span>
            ) : (
              <>{val >= 0 ? '+' : ''}{val.toFixed(2)}</>
            )}
          </div>
        );
      })}
    </>
  );
}

// Custom tooltip
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  
  const formatDate = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-[var(--text-tertiary)] mb-2">{formatDate(label)}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-[var(--text-secondary)]">{entry.name}:</span>
          <span className="text-[var(--text-primary)] font-medium">
            {entry.name.includes('Price') ? `$${formatCompact(entry.value)}` : 
             entry.name.includes('bps') || entry.name.includes('Spread') ? `${entry.value.toFixed(2)} bps` :
             formatCompact(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function RiskPage() {
  const [loading, setLoading] = useState(true);

  // useAvailableCoins is still available here if any future section needs the
  // full market list, but the Fair Spread picker now uses <CoinPicker> which
  // fetches the list internally, so we don't destructure it at the page level.

  // Regime data
  const [regimeData, setRegimeData] = useState<{
    aggregateRegime: number;
    markets: { symbol: string; regime: number; regimeDt: number; regimeVol: number; fairBookPx: number; markPrice: number }[];
  } | null>(null);
  // Active network — included in fetch deps below so switching networks
  // immediately refetches every chart with the new network's data (otherwise
  // the chart keeps the old network's series until the timeframe is toggled).
  const { network } = useCurrentNetwork();

  // Market Regime coin selection — capped at 4 via CoinSelector's maxCount so
  // the gauge grid stays visually manageable. Aggregate card + up to 4 coins
  // fits one row on desktop. The asset table below the gauges is filtered to
  // the same set.
  const [regimeCoins, setRegimeCoins] = useState<string[]>([...DEFAULT_COINS]);

  // Volatility Heatmap / Correlation Matrix coin selection — no cap, but
  // matrix switches to hover-to-reveal values when > ~6 coins so the UI
  // doesn't overflow.
  const [heatmapCoins, setHeatmapCoins] = useState<string[]>([...DEFAULT_COINS]);

  // Volatility chart
  const [volatilityHours, setVolatilityHours] = useState(24);
  const [volatilityData, setVolatilityData] = useState<{ timestamp: string; BTC: number; ETH: number; SOL: number }[]>([]);
  const [volatilityCoins, setVolatilityCoins] = useState<string[]>([...DEFAULT_COINS, OTHER_KEY]);
  
  // Fair spread chart
  const [fairSpreadHours, setFairSpreadHours] = useState(24);
  const [fairSpreadSymbol, setFairSpreadSymbol] = useState('BTC-USD');
  const [fairSpreadData, setFairSpreadData] = useState<{ timestamp: string; markPrice: number; fairPrice: number; spreadBps: number }[]>([]);

  // Fetch regime data (live)
  useEffect(() => {
    const fetchRegime = async () => {
      try {
        const data = await analytics.getRegimeData();
        setRegimeData(data);
      } catch (error) {
        console.error('Failed to fetch regime:', error);
      }
    };
    
    fetchRegime();
    const interval = setInterval(fetchRegime, 10000);
    return () => clearInterval(interval);
  }, [network]);

  // Fetch volatility chart
  useEffect(() => {
    const fetchVolatility = async () => {
      try {
        const data = await analytics.getVolatilityChart(volatilityHours);
        setVolatilityData(data.data || []);
      } catch (error) {
        console.error('Failed to fetch volatility:', error);
      }
    };
    fetchVolatility();
  }, [volatilityHours, network]);

  // Fetch fair spread chart
  useEffect(() => {
    const fetchFairSpread = async () => {
      try {
        const data = await analytics.getFairSpreadChart(fairSpreadSymbol, fairSpreadHours);
        setFairSpreadData(data.data || []);
      } catch (error) {
        console.error('Failed to fetch fair spread:', error);
      }
    };
    fetchFairSpread();
  }, [fairSpreadHours, fairSpreadSymbol, network]);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const timeRanges = [
    { label: '1D', hours: 24 },
    { label: 'W', hours: 168 },
    { label: 'M', hours: 720 },
  ];

  const formatDateForChart = (ts: string, hours: number) => {
    const date = new Date(ts);
    if (hours <= 24) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (hours <= 168) {
      return date.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', hour12: false });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Note: the legacy local `CoinToggle` was removed. The volatility chart now
  // uses the shared `<CoinSelector>` which supports BTC/ETH/SOL defaults plus
  // a dropdown to add any other coin BULK has listed.

  // Calculate heatmap data from regime data — filtered to the coins the user
  // currently has selected for the Volatility Heatmap / Correlation Matrix.
  // The matrix dimensions are exactly `heatmapCoins` × `heatmapCoins`, so
  // selecting 3 coins yields a 3x3 matrix, 8 coins yields 8x8, etc.
  const heatmapData = useMemo(() => {
    if (!regimeData?.markets) return null;

    // Build a lookup from coin (e.g. "BTC") → market record.
    const byCoin = new Map<string, typeof regimeData.markets[number]>();
    for (const m of regimeData.markets) {
      byCoin.set(m.symbol.replace('-USD', ''), m);
    }

    // Keep only coins the user has enabled AND for which we have data.
    const assets = heatmapCoins.filter(c => byCoin.has(c));
    const volData = assets.map(c => byCoin.get(c)!.regimeVol);

    // Normalize volatility to 0-1 scale for color intensity
    const maxVol = Math.max(...volData, 10);
    const normalizedVol = volData.map(v => v / maxVol);

    // Create correlation-like matrix (using spread similarity as proxy).
    // In reality, you'd calculate actual correlation from price data.
    const matrix: number[][] = [];
    for (let i = 0; i < assets.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < assets.length; j++) {
        if (i === j) {
          matrix[i][j] = 1; // Perfect correlation with self
        } else {
          // Use volatility similarity as proxy for correlation
          const volDiff = Math.abs(volData[i] - volData[j]);
          const similarity = 1 - (volDiff / maxVol);
          matrix[i][j] = Math.max(0.3, Math.min(0.95, similarity)); // Clamp between 0.3-0.95
        }
      }
    }

    return { assets, matrix, normalizedVol };
  }, [regimeData, heatmapCoins]);

  // Filtered list of markets for the Market Regime gauge grid and asset table.
  // Only shows the coins the user picked via the regime coin selector.
  const regimeMarkets = useMemo(() => {
    if (!regimeData?.markets) return [];
    const enabledSet = new Set(regimeCoins);
    return regimeData.markets.filter(m => enabledSet.has(m.symbol.replace('-USD', '')));
  }, [regimeData, regimeCoins]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
      <main className="flex-1 w-full px-6 lg:px-10 py-6">
        <h1 className="page-title text-[var(--text-primary)] mb-6">Risk</h1>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4 h-[350px] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Market Regime Section */}
            <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-6">
              <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-[var(--accent-primary)]" />
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Market Regime</h2>
                </div>
                {/* Coin picker for the regime section — capped at 4 via
                    maxCount so the gauge grid stays 1 row (Aggregate card + 4
                    coins). omitOther because regime is per-coin — an "Others"
                    aggregate regime wouldn't make sense. */}
                <CoinSelector
                  enabled={regimeCoins}
                  onChange={setRegimeCoins}
                  maxCount={4}
                  omitOther
                />
              </div>

              {regimeData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="col-span-1 flex flex-col items-center justify-center p-4 bg-[var(--bg-muted)] rounded-lg">
                      <p className="text-sm text-[var(--text-tertiary)] mb-2">Aggregate</p>
                      <p className="text-4xl font-bold" style={{ color: getRegimeLabel(Math.round(regimeData.aggregateRegime)).color }}>
                        {regimeData.aggregateRegime > 0 ? '+' : ''}{regimeData.aggregateRegime.toFixed(1)}
                      </p>
                      <p className="text-sm text-[var(--text-tertiary)] mt-1">
                        {getRegimeLabel(Math.round(regimeData.aggregateRegime)).label}
                      </p>
                    </div>

                    {/* Up to 4 gauge cards from the user-selected coins. */}
                    {regimeMarkets.map(market => (
                      <RegimeGauge
                        key={market.symbol}
                        value={market.regime}
                        symbol={market.symbol.replace('-USD', '')}
                      />
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border-color)]">
                          <th className="text-left py-2 px-3 text-[var(--text-tertiary)] font-medium">Asset</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Mark Price</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Fair Price</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Spread</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Volatility</th>
                          <th className="text-right py-2 px-3 text-[var(--text-tertiary)] font-medium">Regime Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regimeMarkets.map(market => {
                          const spread = market.fairBookPx > 0 
                            ? ((market.markPrice - market.fairBookPx) / market.fairBookPx) * 10000 
                            : 0;
                          const durationMins = Math.floor(market.regimeDt / 60);
                          const durationHrs = Math.floor(durationMins / 60);
                          const durationStr = durationHrs > 0 
                            ? `${durationHrs}h ${durationMins % 60}m` 
                            : `${durationMins}m`;
                          
                          return (
                            <tr key={market.symbol} className="border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--bg-muted)]/50">
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                  <div 
                                    className="w-2 h-2 rounded-full" 
                                    style={{ backgroundColor: getCoinColor(market.symbol.replace('-USD', '')) }} 
                                  />
                                  <span className="font-medium text-[var(--text-primary)]">{market.symbol.replace('-USD', '')}</span>
                                </div>
                              </td>
                              <td className="text-right py-2 px-3 text-[var(--text-primary)] font-mono">
                                ${market.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="text-right py-2 px-3 text-[var(--text-secondary)] font-mono">
                                ${market.fairBookPx.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className={cn(
                                "text-right py-2 px-3 font-mono",
                                spread >= 0 ? "text-[#00B482]" : "text-[#EF4A3C]"
                              )}>
                                {spread >= 0 ? '+' : ''}{spread.toFixed(2)} bps
                              </td>
                              <td className="text-right py-2 px-3 text-[var(--text-primary)] font-mono">
                                {market.regimeVol.toFixed(2)}%
                              </td>
                              <td className="text-right py-2 px-3 text-[var(--text-secondary)]">
                                {durationStr}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="h-32 flex items-center justify-center text-[var(--text-tertiary)]">
                  Loading regime data...
                </div>
              )}
            </div>

            {/* Row 1.5: Margin Surface — full width.
                Sits between Market Regime ("what regime are we in?") and the
                rest of the risk panels because it answers "what does that
                regime mean for your margin?" — the natural follow-up
                question after seeing the regime score. */}
            <MarginSurface />

            {/* Row 1.6: Portfolio Margining explainer — full width.
                Follows the margin surface ("what does one position cost?")
                with "what does a HEDGE cost?" — the cross-asset netting that
                the single-coin surface can't show on its own. */}
            <PortfolioMarginCard />

            {/* Row 2: Fair vs Mark Spread + Volatility History (side-by-side). */}
            <ResizableChartRow storageKey="risk-spread-vol" defaultHeight={250}>
              {/* Fair vs Mark Spread (moved up from Row 3 to Row 2-left). */}
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4 h-full flex flex-col">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-[var(--accent-primary)]" />
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] whitespace-nowrap">Fair vs Mark Spread</h3>
                  </div>
                  <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
                    {timeRanges.map(r => (
                      <button
                        key={r.label}
                        onClick={() => setFairSpreadHours(r.hours)}
                        className={cn(
                          "px-3 py-1 text-xs font-medium rounded transition-colors",
                          fairSpreadHours === r.hours
                            ? "bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]"
                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Single-coin picker — shares visual design with every other
                    coin picker on the site (<CoinPicker>). State is stored as
                    "BTC-USD" but the picker works in bare coin names, so we
                    adapt at the boundary. */}
                <div className="mb-4">
                  <CoinPicker
                    value={fairSpreadSymbol.replace('-USD', '')}
                    onChange={(coin) => setFairSpreadSymbol(`${coin}-USD`)}
                  />
                </div>

                {fairSpreadData.length > 0 ? (
                  <div className="flex-1 min-h-0" style={{ minHeight: 'var(--chart-h, 250px)' }}>
                    <ChartFrame title="Fair vs Mark Spread" className="h-full" yLabel="Spread (bps)" legend={[{ label: 'Positive', color: '#00B482' }, { label: 'Negative', color: '#EF4A3C' }]}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={fairSpreadData}>
                        <defs>
                          <linearGradient id="spreadGradientPos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00B482" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#00B482" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="spreadGradientNeg" x1="0" y1="1" x2="0" y2="0">
                            <stop offset="5%" stopColor="#EF4A3C" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#EF4A3C" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(ts) => formatDateForChart(ts, fairSpreadHours)}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                        />
                        <YAxis
                          tickFormatter={(v) => `${v.toFixed(1)}`}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                          domain={['auto', 'auto']}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        <ReferenceLine y={0} stroke="var(--text-tertiary)" strokeDasharray="3 3" />
                        <Area
                          type="monotone"
                          dataKey="spreadBps"
                          name="Spread (bps)"
                          stroke={fairSpreadData[fairSpreadData.length - 1]?.spreadBps >= 0 ? '#00B482' : '#EF4A3C'}
                          fill={fairSpreadData[fairSpreadData.length - 1]?.spreadBps >= 0 ? 'url(#spreadGradientPos)' : 'url(#spreadGradientNeg)'}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                    </ChartFrame>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex items-center justify-center text-[var(--text-tertiary)]" style={{ minHeight: 'var(--chart-h, 250px)' }}>
                    <p className="text-sm">No spread data yet. Data will appear as it&apos;s collected.</p>
                  </div>
                )}
              </div>

              {/* Volatility History. */}
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4 h-full flex flex-col">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] whitespace-nowrap">Volatility History</h3>
                  </div>
                  <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
                    {timeRanges.map(r => (
                      <button
                        key={r.label}
                        onClick={() => setVolatilityHours(r.hours)}
                        className={cn(
                          "px-3 py-1 text-xs font-medium rounded transition-colors",
                          volatilityHours === r.hours
                            ? "bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]"
                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-4">
                  <CoinSelector enabled={volatilityCoins} onChange={setVolatilityCoins} omitOther />
                </div>

                {volatilityData.length > 0 ? (
                  <div className="flex-1 min-h-0 relative" style={{ minHeight: 'var(--chart-h, 250px)' }}>
                    <ChartFrame title="Volatility" className="h-full" yLabel="Volatility (bps)" legend={volatilityCoins.filter(c => c !== OTHER_KEY).map(c => ({ label: c, color: getCoinColor(c) }))}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={volatilityData.map(row => {
                        // Normalize to {timestamp, coin1, coin2, ...} shape.
                        // Backend returns both legacy top-level keys AND a `coins`
                        // dict — prefer the dict if present, otherwise adapt.
                        const anyRow = row as any;
                        const dict = (anyRow.coins && typeof anyRow.coins === 'object')
                          ? anyRow.coins as Record<string, number>
                          : adaptLegacyRow(anyRow).coins;
                        const out: Record<string, unknown> = { timestamp: row.timestamp };
                        for (const coin of volatilityCoins) {
                          if (coin === OTHER_KEY) continue;
                          // regime_vol is percent-scaled; ×100 → basis points.
                          if (typeof dict[coin] === 'number') out[coin] = dict[coin] * 100;
                        }
                        return out;
                      })}>
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(ts) => formatDateForChart(ts, volatilityHours)}
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                          axisLine={{ stroke: 'var(--border-color)' }}
                          tickLine={false}
                          tickFormatter={(v) => formatCompact(v)}
                        />
                        <Tooltip content={<ChartTooltip />} />
                        {volatilityCoins
                          .filter(coin => coin !== OTHER_KEY)
                          .map(coin => (
                            <Line
                              key={coin}
                              type="monotone"
                              dataKey={coin}
                              stroke={getCoinColor(coin)}
                              strokeWidth={2}
                              dot={false}
                            />
                          ))}
                      </LineChart>
                    </ResponsiveContainer>
                    </ChartFrame>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex items-center justify-center text-[var(--text-tertiary)]" style={{ minHeight: 'var(--chart-h, 250px)' }}>
                    <p className="text-sm">No volatility data yet. Data will appear as it&apos;s collected.</p>
                  </div>
                )}
              </div>
            </ResizableChartRow>

            {/* Row 3: Volatility Heatmap + Correlation Matrix (side-by-side).
                Both are driven by the same `heatmapCoins` state so the two
                panels are always in sync. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Volatility Heatmap. */}
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] whitespace-nowrap">Volatility Heatmap</h3>
                  </div>
                </div>
                {/* omitOther because the heatmap is per-coin; no max because
                    the bars are vertically stacked and can handle many rows. */}
                <div className="mb-4">
                  <CoinSelector enabled={heatmapCoins} onChange={setHeatmapCoins} omitOther />
                </div>

                {heatmapData && heatmapData.assets.length > 0 ? (
                  <div className="space-y-3">
                    {heatmapData.assets.map((asset, i) => {
                      // Look up the current volatility for THIS asset from
                      // regimeData, not from positional indexing — the old
                      // code assumed heatmapData.assets and regimeData.markets
                      // were in lockstep, but now they're filtered independently.
                      const market = regimeData?.markets.find(m => m.symbol.replace('-USD', '') === asset);
                      const vol = market?.regimeVol || 0;
                      const maxVol = 15; // Assume max 15% vol for scaling
                      const width = Math.min(100, (vol / maxVol) * 100);
                      return (
                        <div key={asset} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-sm"
                                style={{ backgroundColor: getCoinColor(asset) }}
                              />
                              <span className="text-[var(--text-primary)]">{asset}</span>
                            </div>
                            <span className="text-[var(--text-secondary)] font-mono">{vol.toFixed(2)}%</span>
                          </div>
                          <div className="h-3 bg-[var(--bg-muted)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${width}%`,
                                backgroundColor: getCoinColor(asset),
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-[var(--text-tertiary)]">
                    {heatmapCoins.length === 0
                      ? 'Select at least one coin above.'
                      : 'Loading heatmap data...'}
                  </div>
                )}
              </div>

              {/* Correlation Matrix. Shares heatmapCoins so picking in either
                  panel updates both. When many coins are selected, cell values
                  are hidden by default and only revealed on hover, so the
                  matrix doesn't overflow the card. */}
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] whitespace-nowrap">Correlation Matrix</h3>
                  </div>
                </div>

                {heatmapData && heatmapData.assets.length > 0 ? (
                  <CorrelationMatrix
                    assets={heatmapData.assets}
                    matrix={heatmapData.matrix}
                  />
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-[var(--text-tertiary)]">
                    {heatmapCoins.length === 0
                      ? 'Select at least one coin in the Volatility Heatmap panel.'
                      : 'Loading correlation data...'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
