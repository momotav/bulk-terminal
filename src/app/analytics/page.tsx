'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { analytics, leaderboard, formatCompact, formatAddress, cn, type LeaderboardEntry } from '@/lib/api';
import { 
  XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Bar, ComposedChart, Line, LineChart, ReferenceLine, Area, AreaChart
} from 'recharts';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import Link from 'next/link';

const timeRanges = [
  { label: '1D', hours: 24 },
  { label: 'W', hours: 168 },
  { label: 'M', hours: 720 },
  { label: 'Q', hours: 2160 },
  { label: 'Y', hours: 8760 },
  { label: 'ALL', hours: 8760 * 2 },
];

const COLORS = {
  BTC: '#00B482',
  ETH: '#2271B5',
  SOL: '#7570B3',
  cumulative: '#FFB548',
  total: '#FFB548',
};

type ChartData = { timestamp: string; BTC: number; ETH: number; SOL: number; total?: number; Cumulative?: number };

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
        "mt-3 h-10 bg-[#1a1a1a] rounded border border-[#282828] relative overflow-hidden select-none",
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
              style={{ backgroundColor: dragging === 'left' ? color : '#888' }} 
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
              style={{ backgroundColor: dragging === 'right' ? color : '#888' }} 
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

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-gray-400 mb-2 border-b border-[#333] pb-2">{formattedDate}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-400">{entry.name}</span>
          </div>
          <span className="text-white font-medium">${formatCompact(entry.value)}</span>
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
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-gray-400 mb-2 border-b border-[#333] pb-2">{formattedDate}</p>
      {payload.filter((e: any) => e.value !== null).map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 text-xs py-0.5">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-400">{entry.name}</span>
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
  <div className="flex items-center gap-0.5 bg-[#1a1a1a] rounded-lg p-0.5 border border-[#282828]">
    {timeRanges.map((t) => (
      <button
        key={t.hours}
        onClick={() => onChange(t.hours)}
        className={cn(
          "px-2 py-1 text-xs font-medium rounded transition-all duration-200",
          value === t.hours
            ? "bg-[#00B482] text-white shadow-sm"
            : "text-gray-500 hover:text-white hover:bg-[#252525]"
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
    "bg-transparent rounded-lg border border-[#222] p-4 transition-opacity duration-300",
    loading && "opacity-60"
  )}>
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <TimeframeSelector value={timeframe} onChange={onTimeframeChange} />
    </div>
    {toggles && <div className="flex flex-wrap items-center gap-2 mb-3">{toggles}</div>}
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
                className="transform -rotate-90 whitespace-nowrap text-[14px] text-gray-400 tracking-wide origin-center"
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
                className="transform rotate-90 whitespace-nowrap text-[14px] text-gray-400 tracking-wide origin-center"
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
  
  // Per-chart coin selections (independent for each chart)
  const [volumeCoins, setVolumeCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [oiCoins, setOiCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [fundingCoins, setFundingCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [tradesCoins, setTradesCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [liquidationsCoins, setLiquidationsCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  const [adlCoins, setAdlCoins] = useState<string[]>(['BTC', 'ETH', 'SOL']);
  
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
    if (!loading) fetchVolumeData();
  }, [volumeHours, loading]);

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
    if (!loading) fetchOiData();
  }, [oiHours, loading]);

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
    if (!loading) fetchFundingData();
  }, [fundingHours, loading]);

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
    if (!loading) fetchLiquidationsData();
  }, [liquidationsHours, loading]);

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
    if (!loading) fetchTradesData();
  }, [tradesHours, loading]);

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
    if (!loading) fetchAdlData();
  }, [adlHours, loading]);

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
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
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

  // Generic function to apply coin filter and cumulative
  const withCumulativeForCoins = useCallback((data: ChartData[], coins: string[]) => {
    let cumulative = 0;
    return data.map(item => {
      const btc = coins.includes('BTC') ? item.BTC : 0;
      const eth = coins.includes('ETH') ? item.ETH : 0;
      const sol = coins.includes('SOL') ? item.SOL : 0;
      cumulative += btc + eth + sol;
      return { ...item, BTC: btc, ETH: eth, SOL: sol, Cumulative: cumulative };
    });
  }, []);

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

  // Per-chart coin toggle component
  const CoinToggle = ({ coin, coins, setCoins }: { coin: string; coins: string[]; setCoins: (coins: string[]) => void }) => (
    <button
      onClick={() => setCoins(coins.includes(coin) ? coins.filter(c => c !== coin) : [...coins, coin])}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-medium transition-all duration-200",
        coins.includes(coin)
          ? "bg-[#1f1f1f] border-[#333] text-white"
          : "bg-transparent border-transparent text-gray-500 hover:text-gray-300"
      )}
    >
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[coin as keyof typeof COLORS] }} />
      {coin}
    </button>
  );

  const CumulativeToggle = ({ label }: { label: string }) => (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1f1f1f] border border-[#333] text-xs text-white">
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.cumulative }} />
      {label}
    </div>
  );

  const NoDataMessage = ({ title }: { title: string }) => (
    <div className="h-[260px] flex flex-col items-center justify-center text-gray-500">
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
  const volumeDataFull = useMemo(() => withCumulativeForCoins(volumeChart, volumeCoins), [volumeChart, volumeCoins, withCumulativeForCoins]);
  const volumeDataFiltered = useMemo(() => sliceDataByRange(volumeDataFull, volumeRange), [volumeDataFull, volumeRange, sliceDataByRange]);

  // Get total cumulative volume from the last data point of the volume chart (from BULK API /klines)
  const totalCumulativeVolume = useMemo(() => {
    if (volumeDataFull.length === 0) return 0;
    const lastPoint = volumeDataFull[volumeDataFull.length - 1];
    return lastPoint.Cumulative || 0;
  }, [volumeDataFull]);
  
  const tradesDataFull = useMemo(() => withCumulativeForCoins(tradesChart, tradesCoins), [tradesChart, tradesCoins, withCumulativeForCoins]);
  const tradesDataFiltered = useMemo(() => sliceDataByRange(tradesDataFull, tradesRange), [tradesDataFull, tradesRange, sliceDataByRange]);
  
  const liquidationsDataFull = useMemo(() => withCumulativeForCoins(liquidationsChart, liquidationsCoins), [liquidationsChart, liquidationsCoins, withCumulativeForCoins]);
  const liquidationsDataFiltered = useMemo(() => sliceDataByRange(liquidationsDataFull, liquidationsRange), [liquidationsDataFull, liquidationsRange, sliceDataByRange]);
  
  const adlDataFull = useMemo(() => withCumulativeForCoins(adlChart, adlCoins), [adlChart, adlCoins, withCumulativeForCoins]);
  const adlDataFiltered = useMemo(() => sliceDataByRange(adlDataFull, adlRange), [adlDataFull, adlRange, sliceDataByRange]);

  return (
    <div className="min-h-screen flex flex-col bg-dark-primary">
     
      <main className="flex-1 w-full px-6 lg:px-10 py-6">
        <h1 className="text-3xl font-bold text-white mb-6">Analytics</h1>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#333] mb-6 rounded-lg overflow-hidden">
          {[
            { label: 'Total Trades', value: stats?.trades.count || 0, format: 'number' },
            { label: 'Total Volume', value: totalCumulativeVolume, format: 'currency' },
            { label: 'Open Interest', value: liveOI, format: 'currency' },
            { label: 'Unique Traders', value: stats?.uniqueTraders || 0, format: 'number' },
          ].map((stat, i) => (
            <div key={i} className="bg-dark-primary p-4">
              <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
              <p className="text-2xl font-bold text-white">
                {stat.format === 'currency' ? `$${formatCompact(stat.value)}` : stat.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-[#111] rounded-lg border border-[#222] p-4 h-[420px] animate-pulse" />
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
                toggles={<>
                  <CoinToggle coin="BTC" coins={volumeCoins} setCoins={setVolumeCoins} />
                  <CoinToggle coin="ETH" coins={volumeCoins} setCoins={setVolumeCoins} />
                  <CoinToggle coin="SOL" coins={volumeCoins} setCoins={setVolumeCoins} />
                  <CumulativeToggle label="Cumulative" />
                </>}
              >
                {volumeDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={volumeDataFiltered} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} barCategoryGap="20%">
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, volumeHours)} 
                            tick={{ fill: '#888', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: '#333' }} 
                            tickLine={false} 
                            interval={getTickInterval(volumeDataFiltered.length, volumeHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={65} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="SOL" stackId="a" fill={COLORS.SOL} animationDuration={300} maxBarSize={80} />
                          <Bar yAxisId="left" dataKey="ETH" stackId="a" fill={COLORS.ETH} animationDuration={300} maxBarSize={80} />
                          <Bar yAxisId="left" dataKey="BTC" stackId="a" fill={COLORS.BTC} radius={[2, 2, 0, 0]} animationDuration={300} maxBarSize={80} />
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} animationDuration={300} />
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
                toggles={<>
                  <CoinToggle coin="BTC" coins={oiCoins} setCoins={setOiCoins} />
                  <CoinToggle coin="ETH" coins={oiCoins} setCoins={setOiCoins} />
                  <CoinToggle coin="SOL" coins={oiCoins} setCoins={setOiCoins} />
                </>}
              >
                {oiChartData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={sliceDataByRange(oiChartData.map(item => ({
                          ...item,
                          BTC: oiCoins.includes('BTC') ? item.BTC : 0,
                          ETH: oiCoins.includes('ETH') ? item.ETH : 0,
                          SOL: oiCoins.includes('SOL') ? item.SOL : 0,
                        })), oiRange)} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                          <defs>
                            <linearGradient id="oiBtcGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={COLORS.BTC} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={COLORS.BTC} stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="oiEthGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={COLORS.ETH} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={COLORS.ETH} stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="oiSolGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={COLORS.SOL} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={COLORS.SOL} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, oiHours)} 
                            tick={{ fill: '#888', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: '#333' }} 
                            tickLine={false} 
                            interval={getTickInterval(oiChartData.length, oiHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={60} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area type="monotone" dataKey="BTC" stroke={COLORS.BTC} fill="url(#oiBtcGradient)" strokeWidth={2} />
                          <Area type="monotone" dataKey="ETH" stroke={COLORS.ETH} fill="url(#oiEthGradient)" strokeWidth={2} />
                          <Area type="monotone" dataKey="SOL" stroke={COLORS.SOL} fill="url(#oiSolGradient)" strokeWidth={2} />
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
                      dataKeys={oiCoins}
                      colors={COLORS}
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
                toggles={<>
                  <CoinToggle coin="BTC" coins={fundingCoins} setCoins={setFundingCoins} />
                  <CoinToggle coin="ETH" coins={fundingCoins} setCoins={setFundingCoins} />
                  <CoinToggle coin="SOL" coins={fundingCoins} setCoins={setFundingCoins} />
                </>}
              >
                {fundingChartData.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={sliceDataByRange(fundingChartData.map(item => ({
                          ...item,
                          BTC: fundingCoins.includes('BTC') ? item.BTC : null,
                          ETH: fundingCoins.includes('ETH') ? item.ETH : null,
                          SOL: fundingCoins.includes('SOL') ? item.SOL : null,
                        })), fundingRange)} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, fundingHours)} 
                            tick={{ fill: '#888', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: '#333' }} 
                            tickLine={false} 
                            interval={getTickInterval(fundingChartData.length, fundingHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis tickFormatter={v => `${(v * 100).toFixed(4)}%`} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={70} domain={['auto', 'auto']} />
                          <ReferenceLine y={0} stroke="#333" strokeDasharray="3 3" />
                          <Tooltip content={<FundingTooltip />} />
                          <Line type="monotone" dataKey="BTC" stroke={COLORS.BTC} strokeWidth={2} dot={false} connectNulls={false} />
                          <Line type="monotone" dataKey="ETH" stroke={COLORS.ETH} strokeWidth={2} dot={false} connectNulls={false} />
                          <Line type="monotone" dataKey="SOL" stroke={COLORS.SOL} strokeWidth={2} dot={false} connectNulls={false} />
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
                      dataKeys={fundingCoins}
                      colors={COLORS}
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
                toggles={<>
                  <CoinToggle coin="BTC" coins={liquidationsCoins} setCoins={setLiquidationsCoins} />
                  <CoinToggle coin="ETH" coins={liquidationsCoins} setCoins={setLiquidationsCoins} />
                  <CoinToggle coin="SOL" coins={liquidationsCoins} setCoins={setLiquidationsCoins} />
                  <CumulativeToggle label="Cumulative" />
                </>}
              >
                {liquidationsDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={liquidationsDataFiltered} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} barCategoryGap="20%">
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, liquidationsHours)} 
                            tick={{ fill: '#888', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: '#333' }} 
                            tickLine={false} 
                            interval={getTickInterval(liquidationsDataFiltered.length, liquidationsHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={65} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="SOL" stackId="a" fill={COLORS.SOL} animationDuration={300} maxBarSize={80} />
                          <Bar yAxisId="left" dataKey="ETH" stackId="a" fill={COLORS.ETH} animationDuration={300} maxBarSize={80} />
                          <Bar yAxisId="left" dataKey="BTC" stackId="a" fill={COLORS.BTC} radius={[2, 2, 0, 0]} animationDuration={300} maxBarSize={80} />
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} animationDuration={300} />
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard 
                title="Number Of Trades"
                timeframe={tradesHours}
                onTimeframeChange={setTradesHours}
                loading={chartLoading.trades}
                isDragging={tradesDragging}
                leftAxisLabel="Daily Trades"
                rightAxisLabel="Cumulative Trades"
                toggles={<>
                  <CoinToggle coin="BTC" coins={tradesCoins} setCoins={setTradesCoins} />
                  <CoinToggle coin="ETH" coins={tradesCoins} setCoins={setTradesCoins} />
                  <CoinToggle coin="SOL" coins={tradesCoins} setCoins={setTradesCoins} />
                  <CumulativeToggle label="Cumulative" />
                </>}
              >
                {tradesDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={tradesDataFiltered} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} barCategoryGap="20%">
                          <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={(ts) => formatDateForChart(ts, tradesHours)} 
                            tick={{ fill: '#888', fontSize: 12, fontFamily: '"Overused Grotesk", sans-serif' }} 
                            axisLine={{ stroke: '#333' }} 
                            tickLine={false} 
                            interval={getTickInterval(tradesDataFiltered.length, tradesHours)}
                            padding={{ left: 10, right: 10 }} 
                          />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={65} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="SOL" stackId="a" fill={COLORS.SOL} animationDuration={300} maxBarSize={80} />
                          <Bar yAxisId="left" dataKey="ETH" stackId="a" fill={COLORS.ETH} animationDuration={300} maxBarSize={80} />
                          <Bar yAxisId="left" dataKey="BTC" stackId="a" fill={COLORS.BTC} radius={[2, 2, 0, 0]} animationDuration={300} maxBarSize={80} />
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} animationDuration={300} />
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
                toggles={<>
                  <CoinToggle coin="BTC" coins={adlCoins} setCoins={setAdlCoins} />
                  <CoinToggle coin="ETH" coins={adlCoins} setCoins={setAdlCoins} />
                  <CoinToggle coin="SOL" coins={adlCoins} setCoins={setAdlCoins} />
                  <CumulativeToggle label="Cumulative" />
                </>}
              >
                {adlDataFull.length > 0 ? (
                  <>
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={adlDataFiltered} margin={{ top: 5, right: 5, bottom: 5, left: 5 }} barCategoryGap="20%">
                          <XAxis dataKey="timestamp" tickFormatter={(ts) => formatDateForChart(ts, adlHours)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} padding={{ left: 20, right: 20 }} />
                          <YAxis yAxisId="left" tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={60} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatCompact(v)} tick={{ fill: '#888', fontSize: 14, fontFamily: '"Overused Grotesk", sans-serif' }} axisLine={{ stroke: '#333' }} tickLine={false} width={65} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="SOL" stackId="a" fill={COLORS.SOL} animationDuration={300} maxBarSize={80} />
                          <Bar yAxisId="left" dataKey="ETH" stackId="a" fill={COLORS.ETH} animationDuration={300} maxBarSize={80} />
                          <Bar yAxisId="left" dataKey="BTC" stackId="a" fill={COLORS.BTC} radius={[2, 2, 0, 0]} animationDuration={300} maxBarSize={80} />
                          <Line yAxisId="right" type="monotone" dataKey="Cumulative" stroke={COLORS.cumulative} strokeWidth={2} dot={false} animationDuration={300} />
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

            <div className="grid grid-cols-1 gap-4">
              <div className="bg-[#111] rounded-lg border border-[#222] p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Top Users By Volume</h3>
                
                {topUsers.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-xs text-gray-500 uppercase tracking-wider pb-3 border-b border-[#222]">
                      <span>Address</span>
                      <button 
                        onClick={() => { setTopUsersSortAsc(!topUsersSortAsc); setTopUsersPage(1); }}
                        className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
                      >
                        Volume USD
                        {topUsersSortAsc ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <div className="divide-y divide-[#222]">
                      {paginatedUsers.map((user) => (
                        <div key={user.wallet_address} className="flex items-center justify-between py-3 hover:bg-[#1a1a1a] -mx-4 px-4 transition-colors">
                          <div className="flex items-center gap-2">
                            <Link href={`/whales/${user.wallet_address}`} className="text-sm text-gray-300 hover:text-white font-mono transition-colors">
                              {formatAddress(user.wallet_address)}
                            </Link>
                            <button onClick={() => copyAddress(user.wallet_address)} className="p-1 hover:bg-[#333] rounded transition-colors">
                              {copiedAddress === user.wallet_address ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-gray-500" />}
                            </button>
                          </div>
                          <span className="text-sm text-white font-medium">${formatCompact(user.value)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#222]">
                      <span className="text-xs text-gray-500">Showing {(topUsersPage - 1) * 10 + 1} - {Math.min(topUsersPage * 10, topUsers.length)} of {topUsers.length}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setTopUsersPage(p => Math.max(1, p - 1))} disabled={topUsersPage === 1} className="p-1.5 rounded border border-[#333] text-gray-400 hover:text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-3 py-1 rounded bg-[#1a1a1a] border border-[#333] text-xs text-white">{topUsersPage} of {totalPages}</span>
                        <button onClick={() => setTopUsersPage(p => Math.min(totalPages, p + 1))} disabled={topUsersPage === totalPages} className="p-1.5 rounded border border-[#333] text-gray-400 hover:text-white hover:bg-[#1a1a1a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-[200px] flex flex-col items-center justify-center text-gray-500">
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
