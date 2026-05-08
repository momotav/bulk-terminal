'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { analytics, leaderboard, formatCompact, formatAddress, cn, type LeaderboardEntry, type ChartData } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Bar, ComposedChart, Line, LineChart, ReferenceLine, Area, AreaChart
} from 'recharts';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import Link from 'next/link';
import { ProtocolRevenueChart } from '@/components/ProtocolRevenueChart';
import { CoinSelector } from '@/components/CoinSelector';
import {
  DEFAULT_COINS,
  OTHER_KEY,
  getCoinColor,
  bucketWithOther,
  adaptLegacyRow,
} from '@/lib/coins';

const timeRanges = [
  { label: '1D', hours: 24 },
  { label: 'W', hours: 168 },
  { label: 'M', hours: 720 },
  { label: 'Q', hours: 2160 },
  { label: 'Y', hours: 8760 },
  { label: 'ALL', hours: 8760 * 2 },
];

// Legacy COLORS map — kept for backward compat with InteractiveRangeSlider defaults
// and a few isolated places. All NEW code should use `getCoinColor(coin)` from
// '@/lib/coins' instead so every coin gets a color, not just BTC/ETH/SOL.
const COLORS = {
  BTC: '#00B482',
  ETH: '#2271B5',
  SOL: '#7570B3',
  [OTHER_KEY]: getCoinColor(OTHER_KEY),
  cumulative: '#FFB548',
  total: '#FFB548',
};

// `ChartData` is imported from '@/lib/api' — see that file for the canonical
// shape. It now includes a `coins: Record<string, number>` field from the
// Phase 2 additive backend response, plus legacy top-level BTC/ETH/SOL fields
// for backward compatibility, plus an index signature for arbitrary coin keys
// (BNB/DOGE/FARTCOIN/SUI/ZEC/etc.).

// Compute the ordered list of coin series to render on a chart. Stacking order
// matters (rendered bottom-to-top): we put non-default coins first so BTC/ETH/SOL
// sit visually on top like they always did, and Other goes very top.
//
// Filters out "Other" if it's not enabled.
function orderedSeriesFor(enabled: readonly string[]): string[] {
  const enabledSet = new Set(enabled);
  const extras = enabled.filter(
    c => c !== OTHER_KEY && !(DEFAULT_COINS as readonly string[]).includes(c)
  );
  const defaults = (DEFAULT_COINS as readonly string[]).filter(c => enabledSet.has(c));
  // Order (bottom → top in a stack): extras → SOL → ETH → BTC → Other.
  // Reversing defaults puts BTC on top as it was in the legacy chart.
  const ordered = [...extras, ...defaults.slice().reverse()];
  if (enabledSet.has(OTHER_KEY)) ordered.push(OTHER_KEY);
  return ordered;
}


// Fixed Interactive Range Slider - follows cursor 1:1
const InteractiveRangeSlider = ({ 
  data, 
  color = '#00B482',
  rangeStart,
  rangeEnd,
  onRangeChange,
  onDraggingChange,
  chartType = 'bar',
  dataKeys = ['BTC', 'ETH', 'SOL'],
  colors = {},
}: { 
  data: any[];
  color?: string;
  rangeStart: number;
  rangeEnd: number;
  onRangeChange: (start: number, end: number) => void;
  onDraggingChange?: (isDragging: boolean) => void;
  chartType?: 'bar' | 'line' | 'area';
  dataKeys?: string[];
  colors?: Record<string, string>;
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | 'middle' | null>(null);
  // Local preview state - updates live during drag without re-rendering main chart
  const [previewStart, setPreviewStart] = useState(rangeStart);
  const [previewEnd, setPreviewEnd] = useState(rangeEnd);
  const dragOffset = useRef(0);
  const rangeWidth = useRef(0);

  // Sync preview with actual range when not dragging
  useEffect(() => {
    if (!dragging) {
      setPreviewStart(rangeStart);
      setPreviewEnd(rangeEnd);
    }
  }, [rangeStart, rangeEnd, dragging]);

  // Notify parent of dragging state
  useEffect(() => {
    onDraggingChange?.(!!dragging);
  }, [dragging, onDraggingChange]);

  const isDisabled = data.length <= 1;

  const clientXToPercent = useCallback((clientX: number): number => {
    if (!sliderRef.current) return 0;
    const rect = sliderRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handleStart = useCallback((clientX: number, type: 'left' | 'right' | 'middle') => {
    if (isDisabled) return;
    const pct = clientXToPercent(clientX);
    if (type === 'left') {
      dragOffset.current = pct - previewStart;
    } else if (type === 'right') {
      dragOffset.current = pct - previewEnd;
    } else {
      rangeWidth.current = previewEnd - previewStart;
      dragOffset.current = pct - previewStart;
    }
    setDragging(type);
  }, [isDisabled, previewStart, previewEnd, clientXToPercent]);

  useEffect(() => {
    if (!dragging) return;

    const move = (clientX: number) => {
      const pct = clientXToPercent(clientX);
      if (dragging === 'left') {
        const newStart = Math.max(0, Math.min(pct - dragOffset.current, previewEnd - 5));
        setPreviewStart(newStart);
      } else if (dragging === 'right') {
        const newEnd = Math.max(previewStart + 5, Math.min(100, pct - dragOffset.current));
        setPreviewEnd(newEnd);
      } else {
        let s = pct - dragOffset.current;
        let e = s + rangeWidth.current;
        if (s < 0) { s = 0; e = rangeWidth.current; }
        if (e > 100) { e = 100; s = 100 - rangeWidth.current; }
        setPreviewStart(s);
        setPreviewEnd(e);
      }
    };

    const onEnd = () => {
      // Only update parent when drag ends
      setDragging(null);
      onRangeChange(previewStart, previewEnd);
    };

    const onMouseMove = (e: MouseEvent) => move(e.clientX);
    const onTouchMove = (e: TouchEvent) => move(e.touches[0].clientX);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onTouchMove);
    document.addEventListener('touchend', onEnd);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [dragging, previewStart, previewEnd, onRangeChange, clientXToPercent]);

  // For bar charts: calculate bar heights
  const maxVal = Math.max(...data.map(d => d.total || (d.BTC || 0) + (d.ETH || 0) + (d.SOL || 0) || d.value || 0), 1);
  const bars = data.length > 0 
    ? data.map(d => ((d.total || (d.BTC || 0) + (d.ETH || 0) + (d.SOL || 0) || d.value || 0) / maxVal) * 100) 
    : Array(30).fill(20);

  // For line/area charts: generate SVG paths for each dataKey
  const generateLinePaths = () => {
    if (data.length === 0) return null;
    
    const height = 32; // Mini chart height in px
    const width = 100; // We'll use percentage
    
    return dataKeys.map((key) => {
      const values = data.map(d => d[key] || 0);
      const maxKeyVal = Math.max(...values, 1);
      
      // Generate path points
      const points = values.map((v, i) => {
        const x = (i / (values.length - 1)) * 100;
        const y = height - (v / maxKeyVal) * (height - 4); // Leave 4px padding
        return `${x},${y}`;
      });
      
      const linePath = `M ${points.join(' L ')}`;
      const areaPath = `M 0,${height} L ${points.join(' L ')} L 100,${height} Z`;
      
      const lineColor = colors[key] || color;
      
      return (
        <g key={key}>
          {chartType === 'area' && (
            <path 
              d={areaPath} 
              fill={`${lineColor}30`}
              stroke="none"
            />
          )}
          <path 
            d={linePath} 
            fill="none" 
            stroke={lineColor} 
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    });
  };

  // Use preview values for visual display
  const displayStart = previewStart;
  const displayEnd = previewEnd;

  return (
    <div 
      ref={sliderRef} 
      className={cn(
        "mt-3 h-10 bg-[var(--bg-muted)] rounded border border-[var(--border-color)] relative overflow-hidden select-none",
        isDisabled && "opacity-50 cursor-not-allowed"
      )} 
      style={{ touchAction: 'none' }}
    >
      {/* Mini chart background */}
      {chartType === 'bar' ? (
        <div className="absolute inset-y-1 left-1 right-1 flex items-end gap-px pointer-events-none">
          {bars.map((h, i) => {
            const pct = (i / bars.length) * 100;
            const inRange = pct >= displayStart && pct <= displayEnd;
            return (
              <div 
                key={i} 
                className="flex-1 rounded-t" 
                style={{ 
                  height: `${Math.max(8, h)}%`, 
                  backgroundColor: inRange ? `${color}50` : `${color}20` 
                }} 
              />
            );
          })}
        </div>
      ) : (
        <svg 
          className="absolute inset-1 pointer-events-none" 
          viewBox="0 0 100 32" 
          preserveAspectRatio="none"
          style={{ width: 'calc(100% - 8px)', height: 'calc(100% - 8px)' }}
        >
          {generateLinePaths()}
        </svg>
      )}

      {!isDisabled && (
        <>
          {/* Dimmed areas */}
          <div 
            className="absolute top-0 bottom-0 left-0 bg-black/50 pointer-events-none" 
            style={{ width: `${displayStart}%` }} 
          />
          <div 
            className="absolute top-0 bottom-0 right-0 bg-black/50 pointer-events-none" 
            style={{ width: `${100 - displayEnd}%` }} 
          />
          
          {/* Middle drag area */}
          <div 
            className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing" 
            style={{ 
              left: `${displayStart}%`, 
              width: `${displayEnd - displayStart}%`, 
              borderLeft: `2px solid ${color}`, 
              borderRight: `2px solid ${color}` 
            }} 
            onMouseDown={e => { e.preventDefault(); handleStart(e.clientX, 'middle'); }} 
            onTouchStart={e => { e.preventDefault(); handleStart(e.touches[0].clientX, 'middle'); }} 
          />
          
          {/* Left handle */}
          <div 
            className="absolute top-0 bottom-0 w-5 cursor-ew-resize flex items-center justify-center z-20" 
            style={{ left: `calc(${displayStart}% - 10px)` }} 
            onMouseDown={e => { e.preventDefault(); handleStart(e.clientX, 'left'); }} 
            onTouchStart={e => { e.preventDefault(); handleStart(e.touches[0].clientX, 'left'); }}
          >
            <div 
              className="w-1.5 h-6 rounded-full transition-colors" 
              style={{ backgroundColor: dragging === 'left' ? color : 'var(--text-secondary)' }} 
            />
          </div>
          
          {/* Right handle */}
          <div 
            className="absolute top-0 bottom-0 w-5 cursor-ew-resize flex items-center justify-center z-20" 
            style={{ left: `calc(${displayEnd}% - 10px)` }} 
            onMouseDown={e => { e.preventDefault(); handleStart(e.clientX, 'right'); }} 
            onTouchStart={e => { e.preventDefault(); handleStart(e.touches[0].clientX, 'right'); }}
          >
            <div 
              className="w-1.5 h-6 rounded-full transition-colors" 
              style={{ backgroundColor: dragging === 'right' ? color : 'var(--text-secondary)' }} 
            />
          </div>
        </>
      )}
    </div>
  );
};

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const date = new Date(label);
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Map dataKey names to display names
  const formatName = (name: string) => {
    const nameMap: Record<string, string> = {
      'newUsers': 'New Users',
      'cumulative': 'Cumulative',
      'dau': 'Daily Active Users',
      'total': 'Total Unique',
      'Cumulative': 'Cumulative',
    };
    return nameMap[name] || name;
  };

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-[var(--text-secondary)] mb-2 border-b border-[var(--border-color)] pb-2">{formattedDate}</p>
      {payload.map((entry: any, i: number) => {
        // Detect "count" vs "USD" series. Named specials (newUsers, cumulative,
        // dau, total) are always counts. Any other series is a coin — we key off
        // value magnitude: trade counts are typically under 1M; USD volumes are
        // well above. This keeps the heuristic coin-agnostic (BTC/ETH/SOL/BNB/
        // DOGE/... all handled the same way) while preserving the original UX.
        const specials = ['newUsers', 'cumulative', 'dau', 'total', 'Cumulative'];
        const isSpecialCount = specials.includes(entry.dataKey);
        const isSmallCoinValue = typeof entry.value === 'number' && entry.value < 1_000_000;
        const skipDollarSign = isSpecialCount || isSmallCoinValue;
        return (
          <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
              <span className="text-[var(--text-secondary)]">{formatName(entry.name)}</span>
            </div>
            <span className="text-[var(--text-primary)] font-medium">
              {skipDollarSign ? formatCompact(entry.value) : `$${formatCompact(entry.value)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// Tooltip specifically for user statistics (no $ prefix)
const UserStatsTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const date = new Date(label);
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const formatName = (name: string) => {
    const nameMap: Record<string, string> = {
      'newUsers': 'New Users',
      'cumulative': 'Cumulative',
      'dau': 'Daily Active Users',
      'total': 'Total Unique',
    };
    return nameMap[name] || name;
  };

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-[var(--text-secondary)] mb-2 border-b border-[var(--border-color)] pb-2">{formattedDate}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="text-[var(--text-secondary)]">{formatName(entry.name)}</span>
          </div>
          <span className="text-[var(--text-primary)] font-medium">{formatCompact(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

const FundingTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const date = new Date(label);
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-[var(--text-secondary)] mb-2 border-b border-[var(--border-color)] pb-2">{formattedDate}</p>
      {payload.filter((e: any) => e.value !== null).map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="text-[var(--text-secondary)]">{entry.name}</span>
          </div>
          <span className={cn("font-medium", entry.value >= 0 ? "text-green-400" : "text-red-400")}>
            {(entry.value * 100).toFixed(4)}%
          </span>
        </div>
      ))}
    </div>
  );
};

// Per-chart timeframe selector
const TimeframeSelector = ({ 
  value, 
  onChange,
}: { 
  value: number; 
  onChange: (hours: number) => void;
}) => (
  <div className="flex items-center gap-0.5 bg-[var(--bg-muted)] rounded-lg p-0.5">
    {timeRanges.map((t) => (
      <button
        key={t.hours}
        onClick={() => onChange(t.hours)}
        className={cn(
          "px-3 py-1 text-xs font-medium rounded transition-colors",
          value === t.hours
            ? "bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        )}
      >
        {t.label}
      </button>
    ))}
  </div>
);

// Chart wrapper component with loading state and Y-axis labels
const ChartCard = ({ 
  title, 
  children, 
  toggles,
  timeframe,
  onTimeframeChange,
  loading = false,
  isDragging = false,
  leftAxisLabel,
  rightAxisLabel,
}: { 
  title: string; 
  children: React.ReactNode; 
  toggles?: React.ReactNode;
  timeframe: number;
  onTimeframeChange: (hours: number) => void;
  loading?: boolean;
  isDragging?: boolean;
  leftAxisLabel?: string;
  rightAxisLabel?: string;
}) => (
  <div className={cn(
    "bg-transparent rounded-lg border border-[var(--border-color)] p-4 transition-opacity duration-300",
    loading && "opacity-60"
  )}>
    {/* Header layout (matches Hyperliquid):
        Row 1: title on the left, timeframe selector on the far right — full width each side
                so the title never wraps into a second line.
        Row 2: toggles (coin pills + dropdown trigger + any extra pills) span full width below.
        This means even with many pills the title stays on a single line at a readable size. */}
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] whitespace-nowrap">{title}</h3>
      <TimeframeSelector value={timeframe} onChange={onTimeframeChange} />
    </div>
    {toggles && (
      <div className="mb-4 flex flex-wrap items-start gap-2">
        {/* flex-wrap + items-start makes standalone pill elements (e.g. the
            plain Daily New / Cumulative divs used by the New Users chart)
            sit snug left-aligned at their natural width instead of stretching
            to the full card width. CoinSelector itself uses the same pattern
            internally, so the two look consistent. */}
        {toggles}
      </div>
    )}
    <div className={cn(
      "relative",
      loading && "blur-sm opacity-60",
      // During drag: slight blur and fade
      isDragging && "blur-[1px] opacity-80",
      // Smooth transition for both entering and exiting drag state
      "transition-all duration-300 ease-out"
    )}>
      {/* Wrapper with axis labels positioned relative to chart height only */}
      <div className="flex">
        {/* Left Y-axis label - positioned to align with chart area (260px height) */}
        {leftAxisLabel && (
          <div className="relative w-6 shrink-0">
            <div className="absolute top-0 h-[260px] flex items-center justify-center w-full">
              <span 
                className="transform -rotate-90 whitespace-nowrap text-[14px] text-[var(--text-secondary)] tracking-wide origin-center"
                style={{ fontFamily: '"Overused Grotesk", sans-serif' }}
              >
                {leftAxisLabel}
              </span>
            </div>
          </div>
        )}
        
        {/* Chart content */}
        <div className="flex-1 min-w-0">
          {children}
        </div>
        
        {/* Right Y-axis label - positioned to align with chart area (260px height) */}
        {rightAxisLabel && (
          <div className="relative w-6 shrink-0">
            <div className="absolute top-0 h-[260px] flex items-center justify-center w-full">
              <span 
                className="transform rotate-90 whitespace-nowrap text-[14px] text-[var(--text-secondary)] tracking-wide origin-center"
                style={{ fontFamily: '"Overused Grotesk", sans-serif' }}
              >
                {rightAxisLabel}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
);

export default function AnalyticsPage() {
  // Per-chart timeframes - default to 24h since BULK just launched
  const [volumeHours, setVolumeHours] = useState(24);
  const [oiHours, setOiHours] = useState(24);
  const [fundingHours, setFundingHours] = useState(24);
  const [liquidationsHours, setLiquidationsHours] = useState(24);
  const [tradesHours, setTradesHours] = useState(24);
  const [adlHours, setAdlHours] = useState(24);
  
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState<Record<string, boolean>>({});
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [topUsersPage, setTopUsersPage] = useState(1);
  const [topUsersSortAsc, setTopUsersSortAsc] = useState(false); // false = high to low (default)

  // Tracks whether the initial fetch (`fetchInitialData` further below) has
  // completed. Per-chart effects consult this so they only fire on
  // *user-driven* timeframe changes, not on the initial mount where the
  // initial fetch already covers everything. Previously per-chart effects
  // depended on `loading` instead, which caused them to fire a second
  // time the moment `loading` flipped to false — duplicating every chart
  // fetch on first page load. Using a ref (vs state) avoids extra
  // re-renders and the dep-array re-fire problem.
  const hasInitiallyLoadedRef = useRef(false);
  
  // Per-chart coin selections (independent for each chart).
  // Default is the 3 original coins + "Other" aggregate on. Users can toggle
  // any coin off, or add more coins via the CoinSelector dropdown.
  const DEFAULT_ENABLED = [...DEFAULT_COINS, OTHER_KEY];
  const [volumeCoins, setVolumeCoins] = useState<string[]>(DEFAULT_ENABLED);
  const [oiCoins, setOiCoins] = useState<string[]>(DEFAULT_ENABLED);
  const [fundingCoins, setFundingCoins] = useState<string[]>(DEFAULT_ENABLED);
  const [tradesCoins, setTradesCoins] = useState<string[]>(DEFAULT_ENABLED);
  const [liquidationsCoins, setLiquidationsCoins] = useState<string[]>(DEFAULT_ENABLED);
  const [adlCoins, setAdlCoins] = useState<string[]>(DEFAULT_ENABLED);
  
  // Range sliders state
  const [volumeRange, setVolumeRange] = useState({ start: 0, end: 100 });
  const [oiRange, setOiRange] = useState({ start: 0, end: 100 });
  const [fundingRange, setFundingRange] = useState({ start: 0, end: 100 });
  const [liquidationsRange, setLiquidationsRange] = useState({ start: 0, end: 100 });
  const [tradesRange, setTradesRange] = useState({ start: 0, end: 100 });
  const [adlRange, setAdlRange] = useState({ start: 0, end: 100 });
  
  // Dragging state for blur effect during slider interaction
  const [volumeDragging, setVolumeDragging] = useState(false);
  const [oiDragging, setOiDragging] = useState(false);
  const [fundingDragging, setFundingDragging] = useState(false);
  const [liquidationsDragging, setLiquidationsDragging] = useState(false);
  const [tradesDragging, setTradesDragging] = useState(false);
  const [adlDragging, setAdlDragging] = useState(false);
  
  // Animation keys - increment when dragging stops to trigger smooth animation
  const [oiAnimKey, setOiAnimKey] = useState(0);
  const [fundingAnimKey, setFundingAnimKey] = useState(0);
  
  // Update animation keys when dragging stops
  useEffect(() => {
    if (!oiDragging) {
      setOiAnimKey(k => k + 1);
    }
  }, [oiDragging]);
  
  useEffect(() => {
    if (!fundingDragging) {
      setFundingAnimKey(k => k + 1);
    }
  }, [fundingDragging]);
  
  // Data state - REAL data from ticker_snapshots via WebSocket collection
  const [oiChartData, setOiChartData] = useState<ChartData[]>([]);
  const [fundingChartData, setFundingChartData] = useState<ChartData[]>([]);
  const [liveOI, setLiveOI] = useState<number>(0); // Live OI from BULK API for stats card
  const [tradesChart, setTradesChart] = useState<ChartData[]>([]);
  const [liquidationsChart, setLiquidationsChart] = useState<ChartData[]>([]);
  const [adlChart, setAdlChart] = useState<ChartData[]>([]);
  const [volumeChart, setVolumeChart] = useState<ChartData[]>([]);
  const [stats, setStats] = useState<{ trades: { count: number; volume: number }; liquidations: { count: number; volume: number }; adl: { count: number; volume: number }; uniqueTraders: number } | null>(null);
  const [topUsers, setTopUsers] = useState<LeaderboardEntry[]>([]);

  // ALL-time reference datasets (fetched once) — used to anchor the Cumulative line
  // so that it continues from the previous period's total instead of resetting to 0
  // when the timeframe changes. Volume, Trades, and Liquidations each need their own.
  const [volumeAllTime, setVolumeAllTime] = useState<ChartData[]>([]);
  const [tradesAllTime, setTradesAllTime] = useState<ChartData[]>([]);
  const [liquidationsAllTime, setLiquidationsAllTime] = useState<ChartData[]>([]);

  // NEW: User statistics charts
  const [uniqueTradersHours, setUniqueTradersHours] = useState(720); // Default 30 days
  const [dauHours, setDauHours] = useState(720);
  const [newUsersHours, setNewUsersHours] = useState(720);
  const [uniqueTradersData, setUniqueTradersData] = useState<{ timestamp: string; BTC: number; ETH: number; SOL: number; total: number }[]>([]);
  const [dauData, setDauData] = useState<{ timestamp: string; dau: number }[]>([]);
  const [newUsersData, setNewUsersData] = useState<{ timestamp: string; newUsers: number; cumulative: number }[]>([]);
  const [uniqueTradersCoins, setUniqueTradersCoins] = useState<string[]>(DEFAULT_ENABLED);
  const [uniqueTradersRange, setUniqueTradersRange] = useState({ start: 0, end: 100 });
  const [dauRange, setDauRange] = useState({ start: 0, end: 100 });
  const [newUsersRange, setNewUsersRange] = useState({ start: 0, end: 100 });
  const [uniqueTradersDragging, setUniqueTradersDragging] = useState(false);
  const [dauDragging, setDauDragging] = useState(false);
  const [newUsersDragging, setNewUsersDragging] = useState(false);
  
  // Animation keys for user stats charts
  const [uniqueTradersAnimKey, setUniqueTradersAnimKey] = useState(0);
  const [newUsersAnimKey, setNewUsersAnimKey] = useState(0);
  const [dauAnimKey, setDauAnimKey] = useState(0);
  
  // Update animation keys when dragging stops
  useEffect(() => {
    if (!uniqueTradersDragging) {
      setUniqueTradersAnimKey(k => k + 1);
    }
  }, [uniqueTradersDragging]);
  
  useEffect(() => {
    if (!newUsersDragging) {
      setNewUsersAnimKey(k => k + 1);
    }
  }, [newUsersDragging]);
  
  useEffect(() => {
    if (!dauDragging) {
      setDauAnimKey(k => k + 1);
    }
  }, [dauDragging]);

  // Fetch LIVE OI directly from BULK API for stats card
  useEffect(() => {
    const fetchLiveOI = async () => {
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://bulk-terminal-backend-production.up.railway.app';
        const [btcRes, ethRes, solRes] = await Promise.all([
          fetch(`${API_URL}/api/analytics/ticker/BTC-USD`),
          fetch(`${API_URL}/api/analytics/ticker/ETH-USD`),
          fetch(`${API_URL}/api/analytics/ticker/SOL-USD`),
        ]);
        
        const [btc, eth, sol] = await Promise.all([
          btcRes.ok ? btcRes.json() : null,
          ethRes.ok ? ethRes.json() : null,
          solRes.ok ? solRes.json() : null,
        ]);
        
        // OI is in coins, multiply by mark price to get USD
        const btcOI = (parseFloat(btc?.openInterest || 0)) * (parseFloat(btc?.markPrice || 0));
        const ethOI = (parseFloat(eth?.openInterest || 0)) * (parseFloat(eth?.markPrice || 0));
        const solOI = (parseFloat(sol?.openInterest || 0)) * (parseFloat(sol?.markPrice || 0));
        
        setLiveOI(btcOI + ethOI + solOI);
      } catch (error) {
        console.error('Failed to fetch live OI:', error);
      }
    };
    
    fetchLiveOI();
    const interval = setInterval(fetchLiveOI, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Fetch ALL-time reference datasets once (and refresh every 5 minutes so new days appear).
  // These are used purely as a source of per-coin historical totals — they anchor the
  // Cumulative line for the three charts that show cumulative (Volume / Trades / Liquidations),
  // so switching to 1D/W/M keeps the line continuous instead of restarting at zero.
  //
  // Each endpoint sets its own state independently the instant it resolves, so the stats
  // card doesn't wait for the slowest of the three. This prevents the Total Volume card
  // from showing a stale or wrong number while trades/liquidations are still in flight.
  useEffect(() => {
    const ALL_HOURS = 8760 * 2;

    const fetchAllTimeReferences = () => {
      analytics.getVolumeFromBulkAPI(ALL_HOURS)
        .then(setVolumeAllTime)
        .catch(err => console.error('Failed to fetch volume all-time:', err));
      analytics.getTradesChart(ALL_HOURS)
        .then(setTradesAllTime)
        .catch(err => console.error('Failed to fetch trades all-time:', err));
      analytics.getLiquidationsChart(ALL_HOURS)
        .then(setLiquidationsAllTime)
        .catch(err => console.error('Failed to fetch liquidations all-time:', err));
    };

    fetchAllTimeReferences();
    const id = setInterval(fetchAllTimeReferences, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch volume data when timeframe changes - now from BULK API klines
  useEffect(() => {
    const fetchVolumeData = async () => {
      setChartLoading(prev => ({ ...prev, volume: true }));
      try {
        const data = await analytics.getVolumeFromBulkAPI(volumeHours);
        setVolumeChart(data);
        setVolumeRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch volume data:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, volume: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchVolumeData();
  }, [volumeHours]);

  // Fetch OI data - REAL HISTORICAL from ticker_snapshots (WebSocket collected)
  useEffect(() => {
    const fetchOiData = async () => {
      setChartLoading(prev => ({ ...prev, oi: true }));
      try {
        const data = await analytics.getOIChart(oiHours);
        setOiChartData(data);
        setOiRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch OI data:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, oi: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchOiData();
  }, [oiHours]);

  // Fetch funding data - REAL HISTORICAL from ticker_snapshots (WebSocket collected)
  useEffect(() => {
    const fetchFundingData = async () => {
      setChartLoading(prev => ({ ...prev, funding: true }));
      try {
        const data = await analytics.getFundingChart(fundingHours);
        setFundingChartData(data);
        setFundingRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch funding data:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, funding: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchFundingData();
  }, [fundingHours]);

  // Fetch liquidations data when timeframe changes
  useEffect(() => {
    const fetchLiquidationsData = async () => {
      setChartLoading(prev => ({ ...prev, liquidations: true }));
      try {
        const data = await analytics.getLiquidationsChart(liquidationsHours);
        setLiquidationsChart(data);
        setLiquidationsRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch liquidations data:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, liquidations: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchLiquidationsData();
  }, [liquidationsHours]);

  // Fetch trades data when timeframe changes - from PostgreSQL database
  useEffect(() => {
    const fetchTradesData = async () => {
      setChartLoading(prev => ({ ...prev, trades: true }));
      try {
        const data = await analytics.getTradesChart(tradesHours);
        setTradesChart(data);
        setTradesRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch trades data:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, trades: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchTradesData();
  }, [tradesHours]);

  // Fetch ADL data when timeframe changes
  useEffect(() => {
    const fetchAdlData = async () => {
      setChartLoading(prev => ({ ...prev, adl: true }));
      try {
        const data = await analytics.getADLChart(adlHours);
        setAdlChart(data);
        setAdlRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch ADL data:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, adl: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchAdlData();
  }, [adlHours]);

  // Fetch Unique Traders by Coin
  useEffect(() => {
    const fetchData = async () => {
      setChartLoading(prev => ({ ...prev, uniqueTraders: true }));
      try {
        const data = await analytics.getUniqueTradersByCoin(uniqueTradersHours);
        setUniqueTradersData(data);
        setUniqueTradersRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch unique traders:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, uniqueTraders: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchData();
  }, [uniqueTradersHours]);

  // Fetch Daily Active Users
  useEffect(() => {
    const fetchData = async () => {
      setChartLoading(prev => ({ ...prev, dau: true }));
      try {
        const data = await analytics.getDailyActiveUsers(dauHours);
        setDauData(data);
        setDauRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch DAU:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, dau: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchData();
  }, [dauHours]);

  // Fetch Cumulative New Users
  useEffect(() => {
    const fetchData = async () => {
      setChartLoading(prev => ({ ...prev, newUsers: true }));
      try {
        const data = await analytics.getCumulativeNewUsers(newUsersHours);
        setNewUsersData(data);
        setNewUsersRange({ start: 0, end: 100 });
      } catch (error) {
        console.error('Failed to fetch new users:', error);
      } finally {
        setChartLoading(prev => ({ ...prev, newUsers: false }));
      }
    };
    // Skip on initial mount — fetchInitialData already did this fetch.
    // Fire only when the user changes the timeframe, marked by the ref.
    if (hasInitiallyLoadedRef.current) fetchData();
  }, [newUsersHours]);

  // Initial data fetch - REAL DATA ONLY
  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      try {
        const results = await Promise.allSettled([
          analytics.getTradesChart(tradesHours),
          analytics.getLiquidationsChart(liquidationsHours),
          analytics.getADLChart(adlHours),
          analytics.getVolumeFromBulkAPI(volumeHours),
          analytics.getStats(),
          leaderboard.getMostActive('all', 100),
          analytics.getOIChart(oiHours),
          analytics.getFundingChart(fundingHours),
          analytics.getUniqueTradersByCoin(uniqueTradersHours),
          analytics.getDailyActiveUsers(dauHours),
          analytics.getCumulativeNewUsers(newUsersHours),
        ]);

        const getValue = <T,>(result: PromiseSettledResult<T>, defaultValue: T): T => {
          return result.status === 'fulfilled' ? result.value : defaultValue;
        };
        
        setTradesChart(getValue(results[0], []));
        setLiquidationsChart(getValue(results[1], []));
        setAdlChart(getValue(results[2], []));
        setVolumeChart(getValue(results[3], []));
        setStats(getValue(results[4], null));
        setTopUsers(getValue(results[5], []));
        setOiChartData(getValue(results[6], []));
        setFundingChartData(getValue(results[7], []));
        setUniqueTradersData(getValue(results[8], []));
        setDauData(getValue(results[9], []));
        setNewUsersData(getValue(results[10], []));
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        // Mark the initial fetch as complete BEFORE flipping `loading`.
        // Per-chart effects below check this ref and skip on mount; if
        // we set the ref after `loading=false` they'd race and one of
        // them might still see `false` on the same tick the ref reads
        // its old value. Order: ref first, then state.
        hasInitiallyLoadedRef.current = true;
        setLoading(false);
      }
    };
    fetchInitialData();
  }, []);

  // Slice data by range (for range slider)
  const sliceDataByRange = useCallback(<T,>(data: T[], range: { start: number; end: number }): T[] => {
    if (data.length <= 1) return data;
    const startIdx = Math.floor((range.start / 100) * data.length);
    const endIdx = Math.ceil((range.end / 100) * data.length);
    return data.slice(startIdx, Math.max(startIdx + 1, endIdx));
  }, []);

  // Given a row from the backend, return its canonical per-coin dictionary.
  // Handles both the new additive shape (`row.coins = { BTC, ETH, ..., BNB }`)
  // and the legacy shape (top-level `row.BTC / row.ETH / row.SOL`).
  //
  // This is what lets us migrate incrementally — if a chart's API response is
  // already additive, we use row.coins directly; if it's still legacy-shape,
  // we fall back to adaptLegacyRow which rebuilds the dict from top-level keys.
  const coinsFromRow = useCallback((row: ChartData): Record<string, number> => {
    if (row.coins && typeof row.coins === 'object') {
      return row.coins as Record<string, number>;
    }
    const adapted = adaptLegacyRow(row as Record<string, unknown>);
    return adapted.coins;
  }, []);

  // Apply coin filter → produce bucketed chart rows → attach cumulative total.
  //
  // Output rows are flat: `{ timestamp, BTC, ETH, SOL, Other, total, Cumulative }`
  // (only the enabled coins + Other appear as keys). Recharts renders each
  // enabled coin as its own `<Bar>` — see the render code below.
  const withCumulativeForCoins = useCallback((data: ChartData[], enabled: string[]) => {
    // Normalize every row to have a `coins` dict so bucketWithOther can run.
    const normalized = data.map(row => ({
      ...row,
      coins: coinsFromRow(row),
    })) as (ChartData & { coins: Record<string, number> })[];

    // Bucket into enabled + Other aggregate.
    const bucketed = bucketWithOther(normalized as any, enabled);

    // Attach cumulative — sum of every numeric key in the bucketed row (these
    // are ONLY enabled coins + Other, no duplicates, no carried extras).
    let cumulative = 0;
    return bucketed.map(row => {
      let rowSum = 0;
      for (const [k, v] of Object.entries(row)) {
        if (k === 'timestamp' || k === 'total' || k === 'Cumulative') continue;
        if (typeof v === 'number') rowSum += v;
      }
      cumulative += rowSum;
      return { ...row, total: rowSum, Cumulative: cumulative };
    });
  }, [coinsFromRow]);

  // Like withCumulativeForCoins, but anchors the Cumulative line to the selected coins'
  // historical total *before* the visible window. Used for Volume / Trades / Liquidations
  // so the cumulative keeps rising instead of resetting to 0 when you switch to 1D/W/M.
  //
  // allTime: the ALL-timeframe dataset for the same metric. Baseline is the sum
  // of enabled-coin values (with Other aggregating the unselected) across allTime
  // points that fall strictly before the visible window's first timestamp.
  const withContinuousCumulative = useCallback((
    visible: ChartData[],
    enabled: string[],
    allTime: ChartData[],
  ) => {
    if (visible.length === 0) return visible as any[];

    // If the all-time dataset is empty or still loading, fall back to plain cumulative.
    if (allTime.length === 0) {
      return withCumulativeForCoins(visible, enabled);
    }

    // Historical baseline = sum of (bucketed) enabled-coin values across allTime
    // points strictly before the visible window's first timestamp.
    const firstVisibleTs = new Date(visible[0].timestamp).getTime();
    const enabledSet = new Set(enabled);
    const showOther = enabledSet.has(OTHER_KEY);

    let baseline = 0;
    for (const point of allTime) {
      const ts = new Date(point.timestamp).getTime();
      if (ts >= firstVisibleTs) break; // allTime is already sorted ascending
      const dict = coinsFromRow(point);
      for (const [coin, v] of Object.entries(dict)) {
        if (typeof v !== 'number' || !isFinite(v)) continue;
        if (enabledSet.has(coin)) baseline += v;
        else if (showOther) baseline += v;
      }
    }

    // Now bucket the visible window and attach cumulative seeded from baseline.
    const normalized = visible.map(row => ({
      ...row,
      coins: coinsFromRow(row),
    })) as (ChartData & { coins: Record<string, number> })[];
    const bucketed = bucketWithOther(normalized as any, enabled);

    let cumulative = baseline;
    return bucketed.map(row => {
      let rowSum = 0;
      for (const [k, v] of Object.entries(row)) {
        if (k === 'timestamp' || k === 'total' || k === 'Cumulative') continue;
        if (typeof v === 'number') rowSum += v;
      }
      cumulative += rowSum;
      return { ...row, total: rowSum, Cumulative: cumulative };
    });
  }, [withCumulativeForCoins, coinsFromRow]);

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  // Smart date formatting - simplified labels for cleaner X-axis
  const formatDateForChart = (ts: string, hours: number) => {
    const date = new Date(ts);
    if (hours <= 24) {
      // 1D: Show just hour (e.g., "14:00")
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (hours <= 168) {
      // 1W: Show day + hour (e.g., "Mon 14:00")
      const day = date.toLocaleDateString('en-US', { weekday: 'short' });
      const hour = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      return `${day} ${hour}`;
    } else if (hours <= 720) {
      // 1M: Show month + day (e.g., "Mar 15")
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      // Longer: Show month + day (e.g., "Mar 15")
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  // Calculate optimal tick interval - show 4-6 clean labels max
  const getTickInterval = (dataLength: number, hours: number) => {
    // Target 4-5 labels for clean spacing
    const targetLabels = hours <= 24 ? 5 : hours <= 168 ? 5 : 5;
    return Math.max(1, Math.floor(dataLength / targetLabels));
  };

  // Note: the legacy `CoinToggle` was removed here. All per-chart coin
  // toggling is handled by the shared `<CoinSelector>` component
  // (src/components/CoinSelector.tsx), which supports BTC/ETH/SOL as default
  // pills plus a dropdown of every other market BULK lists.

  const CumulativeToggle = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[var(--bg-muted)] border border-[var(--border-color)] text-xs text-[var(--text-primary)]">
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.cumulative }} />
      {label}
    </div>
  );

  const NoDataMessage = ({ title }: { title: string }) => (
    <div className="h-[260px] flex flex-col items-center justify-center text-[var(--text-tertiary)]">
      <p className="text-sm">No {title} data yet</p>
      <p className="text-xs mt-1">Data will appear as activity increases</p>
    </div>
  );

  // Sort top users based on sort direction
  const sortedTopUsers = useMemo(() => {
    const sorted = [...topUsers].sort((a, b) => {
      return topUsersSortAsc ? a.value - b.value : b.value - a.value;
    });
    return sorted;
  }, [topUsers, topUsersSortAsc]);

  const paginatedUsers = sortedTopUsers.slice((topUsersPage - 1) * 10, topUsersPage * 10);
  const totalPages = Math.ceil(sortedTopUsers.length / 10) || 1;

  // Filtered data for each chart (each with its own coin selection)
  // Volume, Trades, Liquidations: cumulative is CONTINUOUS across timeframes (seeded from all-time baseline)
  const volumeDataFull = useMemo(() => withContinuousCumulative(volumeChart, volumeCoins, volumeAllTime), [volumeChart, volumeCoins, volumeAllTime, withContinuousCumulative]);
  const volumeDataFiltered = useMemo(() => sliceDataByRange(volumeDataFull, volumeRange), [volumeDataFull, volumeRange, sliceDataByRange]);

  // Get total cumulative volume for the stats card at the top of the page.
  // This MUST match the cumulative line's endpoint regardless of timeframe, so we
  // compute it from the ALL-time dataset rather than the currently visible window.
  //
  // Now sums EVERY coin in each row's `coins` dict (with a legacy-shape fallback
  // for rows that haven't been adapted yet) so BNB/DOGE/FARTCOIN/SUI/ZEC
  // contribute to the total just like BTC/ETH/SOL do. Returns null while the
  // all-time fetch is in flight so the card can render a neutral placeholder
  // instead of the wrong (window-only) number.
  const totalCumulativeVolume = useMemo((): number | null => {
    if (volumeAllTime.length === 0) return null;
    return volumeAllTime.reduce((sum, p) => {
      const dict = coinsFromRow(p);
      let rowSum = 0;
      for (const v of Object.values(dict)) {
        if (typeof v === 'number' && isFinite(v)) rowSum += v;
      }
      return sum + rowSum;
    }, 0);
  }, [volumeAllTime, coinsFromRow]);
  
  const tradesDataFull = useMemo(() => withContinuousCumulative(tradesChart, tradesCoins, tradesAllTime), [tradesChart, tradesCoins, tradesAllTime, withContinuousCumulative]);
  const tradesDataFiltered = useMemo(() => sliceDataByRange(tradesDataFull, tradesRange), [tradesDataFull, tradesRange, sliceDataByRange]);
  
  const liquidationsDataFull = useMemo(() => withContinuousCumulative(liquidationsChart, liquidationsCoins, liquidationsAllTime), [liquidationsChart, liquidationsCoins, liquidationsAllTime, withContinuousCumulative]);
  const liquidationsDataFiltered = useMemo(() => sliceDataByRange(liquidationsDataFull, liquidationsRange), [liquidationsDataFull, liquidationsRange, sliceDataByRange]);
  
  // ADL keeps the per-window cumulative (resets at each timeframe)
  const adlDataFull = useMemo(() => withCumulativeForCoins(adlChart, adlCoins), [adlChart, adlCoins, withCumulativeForCoins]);
  const adlDataFiltered = useMemo(() => sliceDataByRange(adlDataFull, adlRange), [adlDataFull, adlRange, sliceDataByRange]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-base)]">
     
      <main className="flex-1 w-full px-6 lg:px-10 py-6">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-6">General</h1>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--border-color)] mb-6 rounded-lg overflow-hidden">
          {[
            { label: 'Total Trades', value: stats?.trades.count || 0, format: 'number' },
            { label: 'Total Volume', value: totalCumulativeVolume, format: 'currency' },
            { label: 'Open Interest', value: liveOI, format: 'currency' },
            { label: 'Unique Traders', value: stats?.uniqueTraders || 0, format: 'number' },
          ].map((stat, i) => {
            // Show a placeholder dash while the value is still loading (null).
            // This prevents Total Volume from briefly flashing a wrong (window-only)
            // number before the all-time dataset finishes loading.
            const isLoading = stat.value === null || stat.value === undefined;
            let display: string;
            if (isLoading) {
              display = '—';
            } else if (stat.format === 'currency') {
              display = `$${formatCompact(stat.value as number)}`;
            } else {
              display = (stat.value as number).toLocaleString();
            }
            return (
              <div key={i} className="bg-[var(--bg-base)] p-4">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">{stat.label}</p>
                <p className={cn(
                  "text-2xl font-bold text-[var(--text-primary)]",
                  isLoading && "text-[var(--text-tertiary)]"
                )}>
                  {display}
                </p>
              </div>
            );
          })}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4 h-[420px] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard 
                title="Total Volume"
                timeframe={volumeHours}
                onTimeframeChange={setVolumeHours}
                loading={chartLoading.volume}
                isDragging={volumeDragging}
                leftAxisLabel="Daily Volume (USD)"
                rightAxisLabel="Cumulative Volume (USD)"
                toggles={<CoinSelector
                  enabled={volumeCoins}
                  onChange={setVolumeCoins}
                  extraPills={[{
                    key: 'cumulative',
                    label: 'Cumulative Volume',
                    color: COLORS.cumulative,
                    active: true,
                    onClick: () => { /* cumulative line is always on */ },
                  }]}
                />}
              >
                {volumeDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                          data={volumeDataFiltered} 
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }} 
                          barCategoryGap="20%"
                        >
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, volumeHours)} 
                            tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: 'var(--border-color)' }} 
                            tickLine={false} 
                            interval={getTickInterval(volumeDataFiltered.length, volumeHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={65} />
                          <Tooltip content={<ChartTooltip />} />
                          {/* One stacked Bar per enabled coin — dynamic so new coins Just Work. */}
                          {orderedSeriesFor(volumeCoins).map((coin, i, arr) => (
                            <Bar
                              key={coin}
                              yAxisId="left"
                              dataKey={coin}
                              stackId="a"
                              fill={getCoinColor(coin)}
                              maxBarSize={80}
                              animationDuration={600}
                              animationEasing="ease-out"
                              radius={i === arr.length - 1 ? [2, 2, 0, 0] : undefined}
                            />
                          ))}
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} animationDuration={800} animationEasing="ease-out" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={volumeDataFull} 
                      color={COLORS.BTC}
                      rangeStart={volumeRange.start}
                      rangeEnd={volumeRange.end}
                      onRangeChange={(start, end) => setVolumeRange({ start, end })}
                      onDraggingChange={setVolumeDragging}
                    />
                  </>
                ) : <NoDataMessage title="volume" />}
              </ChartCard>

              {/* Open Interest - REAL HISTORICAL DATA from ticker_snapshots */}
              <ChartCard 
                title="Open Interest"
                timeframe={oiHours}
                onTimeframeChange={setOiHours}
                loading={chartLoading.oi}
                isDragging={oiDragging}
                leftAxisLabel="Open Interest (USD)"
                toggles={<CoinSelector enabled={oiCoins} onChange={setOiCoins} />}
              >
                {oiChartData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart 
                          key={`oi-${oiAnimKey}`}
                          data={sliceDataByRange(
                            bucketWithOther(
                              oiChartData.map(r => ({ ...r, coins: coinsFromRow(r) })) as any,
                              oiCoins
                            ),
                            oiRange
                          )}
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                        >
                          <defs>
                            {/* One gradient per enabled coin — generated from getCoinColor. */}
                            {orderedSeriesFor(oiCoins).map(coin => (
                              <linearGradient key={coin} id={`oiGrad_${coin}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={getCoinColor(coin)} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={getCoinColor(coin)} stopOpacity={0} />
                              </linearGradient>
                            ))}
                          </defs>
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, oiHours)} 
                            tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: 'var(--border-color)' }} 
                            tickLine={false} 
                            interval={getTickInterval(oiChartData.length, oiHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={60} />
                          <Tooltip content={<ChartTooltip />} />
                          {orderedSeriesFor(oiCoins).map(coin => (
                            <Area
                              key={coin}
                              type="monotone"
                              dataKey={coin}
                              stroke={getCoinColor(coin)}
                              fill={`url(#oiGrad_${coin})`}
                              strokeWidth={2}
                              isAnimationActive={true}
                              animationDuration={800}
                              animationEasing="ease-in-out"
                            />
                          ))}
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={oiChartData} 
                      color={COLORS.BTC}
                      rangeStart={oiRange.start}
                      rangeEnd={oiRange.end}
                      onRangeChange={(start, end) => setOiRange({ start, end })}
                      onDraggingChange={setOiDragging}
                      chartType="area"
                      dataKeys={orderedSeriesFor(oiCoins)}
                      colors={Object.fromEntries(orderedSeriesFor(oiCoins).map(c => [c, getCoinColor(c)]))}
                    />
                  </>
                ) : <NoDataMessage title="open interest" />}
              </ChartCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Funding Rate - REAL HISTORICAL DATA from ticker_snapshots */}
              <ChartCard 
                title="Funding Rate"
                timeframe={fundingHours}
                onTimeframeChange={setFundingHours}
                loading={chartLoading.funding}
                isDragging={fundingDragging}
                leftAxisLabel="Funding Rate (%)"
                toggles={<CoinSelector enabled={fundingCoins} onChange={setFundingCoins} />}
              >
                {fundingChartData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart 
                          key={`funding-${fundingAnimKey}`}
                          data={sliceDataByRange(
                            // Funding is a rate (not a quantity we can sum into Other),
                            // so for the Line chart we keep each enabled coin as its
                            // own series and simply omit the non-enabled ones.
                            fundingChartData.map(item => {
                              const dict = coinsFromRow(item);
                              const row: Record<string, unknown> = { timestamp: item.timestamp };
                              for (const coin of orderedSeriesFor(fundingCoins)) {
                                if (coin === OTHER_KEY) continue; // "Other" meaningless for a rate
                                row[coin] = typeof dict[coin] === 'number' ? dict[coin] : null;
                              }
                              return row;
                            }),
                            fundingRange
                          )}
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                        >
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, fundingHours)} 
                            tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: 'var(--border-color)' }} 
                            tickLine={false} 
                            interval={getTickInterval(fundingChartData.length, fundingHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis tickFormatter={v => `${(v * 100).toFixed(4)}%`} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={70} domain={['auto', 'auto']} />
                          <ReferenceLine y={0} stroke="var(--border-color)" strokeDasharray="3 3" />
                          <Tooltip content={<FundingTooltip />} />
                          {orderedSeriesFor(fundingCoins)
                            .filter(c => c !== OTHER_KEY)
                            .map(coin => (
                              <Line
                                key={coin}
                                type="monotone"
                                dataKey={coin}
                                stroke={getCoinColor(coin)}
                                strokeWidth={2}
                                dot={false}
                                connectNulls={false}
                                isAnimationActive={true}
                                animationDuration={800}
                                animationEasing="ease-in-out"
                              />
                            ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={fundingChartData} 
                      color={COLORS.BTC}
                      rangeStart={fundingRange.start}
                      rangeEnd={fundingRange.end}
                      onRangeChange={(start, end) => setFundingRange({ start, end })}
                      onDraggingChange={setFundingDragging}
                      chartType="line"
                      dataKeys={orderedSeriesFor(fundingCoins).filter(c => c !== OTHER_KEY)}
                      colors={Object.fromEntries(orderedSeriesFor(fundingCoins).filter(c => c !== OTHER_KEY).map(c => [c, getCoinColor(c)]))}
                    />
                  </>
                ) : <NoDataMessage title="funding rate" />}
              </ChartCard>

              <ChartCard 
                title="Liquidations"
                timeframe={liquidationsHours}
                onTimeframeChange={setLiquidationsHours}
                loading={chartLoading.liquidations}
                isDragging={liquidationsDragging}
                leftAxisLabel="Daily Liquidations (USD)"
                rightAxisLabel="Cumulative (USD)"
                toggles={<CoinSelector
                  enabled={liquidationsCoins}
                  onChange={setLiquidationsCoins}
                  extraPills={[{
                    key: 'cumulative',
                    label: 'Cumulative',
                    color: COLORS.cumulative,
                    active: true,
                    onClick: () => {},
                  }]}
                />}
              >
                {liquidationsDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                          data={liquidationsDataFiltered} 
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }} 
                          barCategoryGap="20%"
                        >
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, liquidationsHours)} 
                            tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: 'var(--border-color)' }} 
                            tickLine={false} 
                            interval={getTickInterval(liquidationsDataFiltered.length, liquidationsHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={65} />
                          <Tooltip content={<ChartTooltip />} />
                          {orderedSeriesFor(liquidationsCoins).map((coin, i, arr) => (
                            <Bar
                              key={coin}
                              yAxisId="left"
                              dataKey={coin}
                              stackId="a"
                              fill={getCoinColor(coin)}
                              maxBarSize={80}
                              animationDuration={600}
                              animationEasing="ease-out"
                              radius={i === arr.length - 1 ? [2, 2, 0, 0] : undefined}
                            />
                          ))}
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} animationDuration={800} animationEasing="ease-out" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={liquidationsDataFull} 
                      color="#EF4A3C"
                      rangeStart={liquidationsRange.start}
                      rangeEnd={liquidationsRange.end}
                      onRangeChange={(start, end) => setLiquidationsRange({ start, end })}
                      onDraggingChange={setLiquidationsDragging}
                    />
                  </>
                ) : <NoDataMessage title="liquidation" />}
              </ChartCard>
            </div>

            {/* Row 3: Protocol Revenue Chart */}
            <div className="grid grid-cols-1 gap-4">
              <ProtocolRevenueChart />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard 
                title="Number Of Trades"
                timeframe={tradesHours}
                onTimeframeChange={setTradesHours}
                loading={chartLoading.trades}
                isDragging={tradesDragging}
                leftAxisLabel="Daily Trades"
                rightAxisLabel="Cumulative Trades"
                toggles={<CoinSelector
                  enabled={tradesCoins}
                  onChange={setTradesCoins}
                  extraPills={[{
                    key: 'cumulative',
                    label: 'Cumulative',
                    color: COLORS.cumulative,
                    active: true,
                    onClick: () => {},
                  }]}
                />}
              >
                {tradesDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                          data={tradesDataFiltered} 
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }} 
                          barCategoryGap="20%"
                        >
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, tradesHours)} 
                            tick={{ fill: 'var(--text-secondary)', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: 'var(--border-color)' }} 
                            tickLine={false} 
                            interval={getTickInterval(tradesDataFiltered.length, tradesHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={65} />
                          <Tooltip content={<ChartTooltip />} />
                          {orderedSeriesFor(tradesCoins).map((coin, i, arr) => (
                            <Bar
                              key={coin}
                              yAxisId="left"
                              dataKey={coin}
                              stackId="a"
                              fill={getCoinColor(coin)}
                              maxBarSize={80}
                              animationDuration={600}
                              animationEasing="ease-out"
                              radius={i === arr.length - 1 ? [2, 2, 0, 0] : undefined}
                            />
                          ))}
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} animationDuration={800} animationEasing="ease-out" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={tradesDataFull} 
                      color={COLORS.BTC}
                      rangeStart={tradesRange.start}
                      rangeEnd={tradesRange.end}
                      onRangeChange={(start, end) => setTradesRange({ start, end })}
                      onDraggingChange={setTradesDragging}
                    />
                  </>
                ) : <NoDataMessage title="trades" />}
              </ChartCard>

              <ChartCard 
                title="Auto-Deleveraging (ADL)"
                timeframe={adlHours}
                onTimeframeChange={setAdlHours}
                loading={chartLoading.adl}
                isDragging={adlDragging}
                leftAxisLabel="Daily ADL (USD)"
                rightAxisLabel="Cumulative ADL (USD)"
                toggles={<CoinSelector
                  enabled={adlCoins}
                  onChange={setAdlCoins}
                  extraPills={[{
                    key: 'cumulative',
                    label: 'Cumulative',
                    color: COLORS.cumulative,
                    active: true,
                    onClick: () => {},
                  }]}
                />}
              >
                {adlDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                          
                          data={adlDataFiltered} 
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }} 
                          barCategoryGap="20%"
                        >
                          <XAxis dataKey="timestamp" tickFormatter={(ts) => formatDateForChart(ts, adlHours)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} padding={{ left: 20, right: 20 }} />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={65} />
                          <Tooltip content={<ChartTooltip />} />
                          {orderedSeriesFor(adlCoins).map((coin, i, arr) => (
                            <Bar
                              key={coin}
                              yAxisId="left"
                              dataKey={coin}
                              stackId="a"
                              fill={getCoinColor(coin)}
                              maxBarSize={80}
                              animationDuration={600}
                              animationEasing="ease-out"
                              radius={i === arr.length - 1 ? [2, 2, 0, 0] : undefined}
                            />
                          ))}
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} animationDuration={800} animationEasing="ease-out" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={adlDataFull} 
                      color={COLORS.SOL}
                      rangeStart={adlRange.start}
                      rangeEnd={adlRange.end}
                      onRangeChange={(start, end) => setAdlRange({ start, end })}
                      onDraggingChange={setAdlDragging}
                    />
                  </>
                ) : <NoDataMessage title="ADL" />}
              </ChartCard>
            </div>

            {/* New Row: Unique Traders by Coin + Cumulative New Users (side by side) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Unique Traders by Coin */}
              <ChartCard 
                title="Unique Traders By Coin"
                timeframe={uniqueTradersHours}
                onTimeframeChange={setUniqueTradersHours}
                loading={chartLoading.uniqueTraders}
                isDragging={uniqueTradersDragging}
                leftAxisLabel="Traders per Coin"
                rightAxisLabel="Total Unique"
                toggles={<CoinSelector
                  enabled={uniqueTradersCoins}
                  onChange={setUniqueTradersCoins}
                  extraPills={[{
                    key: 'total',
                    label: 'Total Unique',
                    color: COLORS.total,
                    active: true,
                    onClick: () => {},
                  }]}
                />}
              >
                {uniqueTradersData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                          key={`unique-traders-${uniqueTradersAnimKey}`}
                          data={sliceDataByRange(
                            // Bucket into enabled + Other; preserve the `total` field
                            // (pre-computed unique-wallet count) for the right-axis line.
                            bucketWithOther(
                              uniqueTradersData.map(r => ({ ...r, coins: coinsFromRow(r as any) })) as any,
                              uniqueTradersCoins
                            ),
                            uniqueTradersRange
                          )}
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }} 
                          barCategoryGap={sliceDataByRange(uniqueTradersData, uniqueTradersRange).length <= 5 ? "30%" : "20%"}
                        >
                          <XAxis dataKey="timestamp" tickFormatter={(ts) => formatDateForChart(ts, uniqueTradersHours)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} padding={{ left: 20, right: 20 }} />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={65} />
                          <Tooltip content={<UserStatsTooltip />} />
                          {orderedSeriesFor(uniqueTradersCoins).map((coin, i, arr) => (
                            <Bar
                              key={coin}
                              yAxisId="left"
                              dataKey={coin}
                              stackId="a"
                              fill={getCoinColor(coin)}
                              animationDuration={400}
                              animationEasing="ease-out"
                              maxBarSize={sliceDataByRange(uniqueTradersData, uniqueTradersRange).length <= 3 ? 150 : 80}
                              radius={i === arr.length - 1 ? [2, 2, 0, 0] : undefined}
                            />
                          ))}
                          <Line yAxisId="right" type="monotone" dataKey="total" stroke={COLORS.total} strokeWidth={2} dot={false} isAnimationActive={true} animationDuration={500} animationEasing="ease-in-out" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={uniqueTradersData} 
                      color={COLORS.BTC}
                      rangeStart={uniqueTradersRange.start}
                      rangeEnd={uniqueTradersRange.end}
                      onRangeChange={(start, end) => setUniqueTradersRange({ start, end })}
                      onDraggingChange={setUniqueTradersDragging}
                    />
                  </>
                ) : <NoDataMessage title="unique traders" />}
              </ChartCard>

              {/* Cumulative New Users */}
              <ChartCard 
                title="Cumulative New Users"
                timeframe={newUsersHours}
                onTimeframeChange={setNewUsersHours}
                loading={chartLoading.newUsers}
                isDragging={newUsersDragging}
                leftAxisLabel="Daily New Users"
                rightAxisLabel="Cumulative"
                toggles={<>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[var(--bg-muted)] border border-[var(--border-color)] text-xs text-[var(--text-primary)]">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.BTC }} />
                    Daily New
                  </div>
                  <CumulativeToggle label="Cumulative" />
                </>}
              >
                {newUsersData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                          key={`new-users-${newUsersAnimKey}`}
                          data={sliceDataByRange(newUsersData, newUsersRange)} 
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }} 
                          barCategoryGap={sliceDataByRange(newUsersData, newUsersRange).length <= 5 ? "30%" : "20%"}
                        >
                          <XAxis dataKey="timestamp" tickFormatter={(ts) => formatDateForChart(ts, newUsersHours)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} padding={{ left: 20, right: 20 }} />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={65} />
                          <Tooltip content={<UserStatsTooltip />} />
                          <Bar yAxisId="left" dataKey="newUsers" fill={COLORS.BTC} animationDuration={400} animationEasing="ease-out" maxBarSize={sliceDataByRange(newUsersData, newUsersRange).length <= 3 ? 150 : 80} radius={[2, 2, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} isAnimationActive={true} animationDuration={500} animationEasing="ease-in-out" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={newUsersData} 
                      color={COLORS.BTC}
                      rangeStart={newUsersRange.start}
                      rangeEnd={newUsersRange.end}
                      onRangeChange={(start, end) => setNewUsersRange({ start, end })}
                      onDraggingChange={setNewUsersDragging}
                    />
                  </>
                ) : <NoDataMessage title="new users" />}
              </ChartCard>
            </div>

            {/* Full Width: Daily Active Users */}
            <div className="grid grid-cols-1 gap-4">
              <ChartCard 
                title="Daily Active Users"
                timeframe={dauHours}
                onTimeframeChange={setDauHours}
                loading={chartLoading.dau}
                isDragging={dauDragging}
                leftAxisLabel="Active Users"
                toggles={<>
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[var(--bg-muted)] border border-[var(--border-color)] text-xs text-[var(--text-primary)]">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.BTC }} />
                    Daily Active Users
                  </div>
                </>}
              >
                {dauData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                          key={`dau-${dauAnimKey}`}
                          data={sliceDataByRange(dauData, dauRange)} 
                          margin={{ top: 5, right: 5, bottom: 5, left: 5 }} 
                          barCategoryGap={sliceDataByRange(dauData, dauRange).length <= 5 ? "25%" : "15%"}
                        >
                          <XAxis dataKey="timestamp" tickFormatter={(ts) => formatDateForChart(ts, dauHours)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} padding={{ left: 20, right: 20 }} />
                          <YAxis tickFormatter={v => formatCompact(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: 'var(--border-color)' }} tickLine={false} width={60} />
                          <Tooltip content={<UserStatsTooltip />} />
                          <Bar dataKey="dau" fill={COLORS.BTC} animationDuration={400} animationEasing="ease-out" maxBarSize={sliceDataByRange(dauData, dauRange).length <= 3 ? 200 : 80} radius={[2, 2, 0, 0]} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <InteractiveRangeSlider 
                      data={dauData} 
                      color={COLORS.BTC}
                      rangeStart={dauRange.start}
                      rangeEnd={dauRange.end}
                      onRangeChange={(start, end) => setDauRange({ start, end })}
                      onDraggingChange={setDauDragging}
                    />
                  </>
                ) : <NoDataMessage title="daily active users" />}
              </ChartCard>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] p-4">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Top Users By Volume</h3>
                
                {topUsers.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)] uppercase tracking-wider pb-3 border-b border-[var(--border-color)]">
                      <span>Address</span>
                      <button 
                        onClick={() => { setTopUsersSortAsc(!topUsersSortAsc); setTopUsersPage(1); }}
                        className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                      >
                        Volume USD
                        {topUsersSortAsc ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <div className="divide-y divide-[var(--border-color)]">
                      {paginatedUsers.map((user) => (
                        <div key={user.wallet_address} className="flex items-center justify-between py-3 hover:bg-[var(--bg-muted)] -mx-4 px-4 transition-colors">
                          <div className="flex items-center gap-2">
                            <Link href={`/whales/${user.wallet_address}`} className="text-sm text-gray-300 hover:text-[var(--text-primary)] font-mono transition-colors">
                              {formatAddress(user.wallet_address)}
                            </Link>
                            <button onClick={() => copyAddress(user.wallet_address)} className="p-1 hover:bg-[var(--border-color)] rounded transition-colors">
                              {copiedAddress === user.wallet_address ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-[var(--text-tertiary)]" />}
                            </button>
                          </div>
                          <span className="text-sm text-[var(--text-primary)] font-medium">${formatCompact(user.value)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border-color)]">
                      <span className="text-xs text-[var(--text-tertiary)]">Showing {(topUsersPage - 1) * 10 + 1} - {Math.min(topUsersPage * 10, topUsers.length)} of {topUsers.length}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setTopUsersPage(p => Math.max(1, p - 1))} disabled={topUsersPage === 1} className="p-1.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-3 py-1 rounded bg-[var(--bg-muted)] border border-[var(--border-color)] text-xs text-[var(--text-primary)]">{topUsersPage} of {totalPages}</span>
                        <button onClick={() => setTopUsersPage(p => Math.min(totalPages, p + 1))} disabled={topUsersPage === totalPages} className="p-1.5 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-[200px] flex flex-col items-center justify-center text-[var(--text-tertiary)]">
                    <p className="text-sm">No traders yet</p>
                    <p className="text-xs mt-1">Data will appear as users trade on testnet</p>
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
