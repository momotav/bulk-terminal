'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { analytics, formatCurrency, formatCompact, formatAddress, formatNumber, cn } from '@/lib/api';
import { 
  ComposedChart, Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Cell, ReferenceLine, Legend
} from 'recharts';
import { Flame, TrendingUp, TrendingDown, ChevronDown, ExternalLink } from 'lucide-react';

// Time period options
const PERIODS = [
  { label: '4H', value: '4h' },
  { label: 'D', value: '24h' },
  { label: '3D', value: '3d' },
  { label: 'W', value: '7d' },
  { label: 'ALL', value: 'all' },
];

const COINS = ['BTC', 'ETH', 'SOL'];

// Colors
const COLORS = {
  long: '#00B481',  // Green (bids)
  short: '#EF4A3C', // Red (asks)
  BTC: '#F7931A',
  ETH: '#627EEA',
  SOL: '#00FFA3',
  XRP: '#23292F',
  GOLD: '#FFD700',
};

// Interactive Range Slider for liquidations chart
const LiquidationRangeSlider = ({ 
  data, 
  rangeStart,
  rangeEnd,
  onRangeChange,
}: { 
  data: { longValue: number; shortValue: number }[];
  rangeStart: number;
  rangeEnd: number;
  onRangeChange: (start: number, end: number) => void;
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'left' | 'right' | 'middle' | null>(null);
  const [previewStart, setPreviewStart] = useState(rangeStart);
  const [previewEnd, setPreviewEnd] = useState(rangeEnd);
  const dragOffset = useRef(0);
  const rangeWidth = useRef(0);

  useEffect(() => {
    if (!dragging) {
      setPreviewStart(rangeStart);
      setPreviewEnd(rangeEnd);
    }
  }, [rangeStart, rangeEnd, dragging]);

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

  // Generate SVG path for mini chart
  const generatePaths = () => {
    if (data.length === 0) return null;
    
    const height = 32;
    const maxLong = Math.max(...data.map(d => d.longValue), 1);
    const maxShort = Math.max(...data.map(d => d.shortValue), 1);
    const maxVal = Math.max(maxLong, maxShort);
    
    const longPoints = data.map((d, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = (height / 2) - (d.longValue / maxVal) * (height / 2 - 2);
      return `${x},${y}`;
    });
    
    const shortPoints = data.map((d, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = (height / 2) + (d.shortValue / maxVal) * (height / 2 - 2);
      return `${x},${y}`;
    });
    
    return (
      <>
        <path d={`M ${longPoints.join(' L ')}`} fill="none" stroke={COLORS.long} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={`M ${shortPoints.join(' L ')}`} fill="none" stroke={COLORS.short} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={height/2} x2="100" y2={height/2} stroke="var(--border-color)" strokeWidth="0.5" />
      </>
    );
  };

  const displayStart = previewStart;
  const displayEnd = previewEnd;

  return (
    <div 
      ref={sliderRef} 
      className={cn(
        "mt-2 h-10 bg-[var(--bg-muted)] rounded border border-[var(--border-color)] relative overflow-hidden select-none",
        isDisabled && "opacity-50 cursor-not-allowed"
      )} 
      style={{ touchAction: 'none' }}
    >
      {/* Mini chart */}
      <svg 
        className="absolute inset-1 pointer-events-none" 
        viewBox="0 0 100 32" 
        preserveAspectRatio="none"
        style={{ width: 'calc(100% - 8px)', height: 'calc(100% - 8px)' }}
      >
        {generatePaths()}
      </svg>

      {!isDisabled && (
        <>
          {/* Dimmed areas */}
          <div className="absolute top-0 bottom-0 left-0 bg-black/50 pointer-events-none" style={{ width: `${displayStart}%` }} />
          <div className="absolute top-0 bottom-0 right-0 bg-black/50 pointer-events-none" style={{ width: `${100 - displayEnd}%` }} />
          
          {/* Middle drag area */}
          <div 
            className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing" 
            style={{ left: `${displayStart}%`, width: `${displayEnd - displayStart}%`, borderLeft: '2px solid var(--accent)', borderRight: '2px solid var(--accent)' }} 
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
            <div className="w-1.5 h-6 rounded-full transition-colors" style={{ backgroundColor: dragging === 'left' ? 'var(--accent)' : 'var(--text-secondary)' }} />
          </div>
          
          {/* Right handle */}
          <div 
            className="absolute top-0 bottom-0 w-5 cursor-ew-resize flex items-center justify-center z-20" 
            style={{ left: `calc(${displayEnd}% - 10px)` }} 
            onMouseDown={e => { e.preventDefault(); handleStart(e.clientX, 'right'); }} 
            onTouchStart={e => { e.preventDefault(); handleStart(e.touches[0].clientX, 'right'); }}
          >
            <div className="w-1.5 h-6 rounded-full transition-colors" style={{ backgroundColor: dragging === 'right' ? 'var(--accent)' : 'var(--text-secondary)' }} />
          </div>
        </>
      )}
    </div>
  );
};

// Treemap component - proper squarified layout
function LiquidationTreemap({ 
  data, 
  totalValue, 
  assets 
}: { 
  data: { symbol: string; side: string; value: number; count: number }[];
  totalValue: number;
  assets: number;
}) {
  const [hoveredItem, setHoveredItem] = useState<{ symbol: string; total: number; long: number; short: number; dominantSide: string; x: number; y: number } | null>(null);

  // Group by symbol - one rectangle per coin with dominant color
  const treemapItems = useMemo(() => {
    const groups: Record<string, { long: number; short: number; total: number }> = {};
    const allowedSymbols = ['BTC', 'ETH', 'SOL'];
    
    for (const item of data) {
      if (!allowedSymbols.includes(item.symbol)) continue;
      
      if (!groups[item.symbol]) {
        groups[item.symbol] = { long: 0, short: 0, total: 0 };
      }
      if (item.side === 'long') {
        groups[item.symbol].long += item.value;
      } else {
        groups[item.symbol].short += item.value;
      }
      groups[item.symbol].total += item.value;
    }
    
    return Object.entries(groups)
      .map(([symbol, values]) => ({
        symbol,
        value: values.total,
        long: values.long,
        short: values.short,
        // Color based on dominant side
        color: values.short >= values.long ? COLORS.short : COLORS.long,
        dominantSide: values.short >= values.long ? 'SHORT' : 'LONG'
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data]);

  // Calculate total for percentage
  const total = useMemo(() => {
    return treemapItems.reduce((sum, item) => sum + item.value, 0);
  }, [treemapItems]);

  // Treemap algorithm - slice and dice with better layout
  const calculateTreemap = useMemo(() => {
    if (treemapItems.length === 0 || total === 0) return [];

    interface TreemapRect {
      x: number;
      y: number;
      width: number;
      height: number;
      item: typeof treemapItems[0];
    }
    
    const rects: TreemapRect[] = [];
    const items = [...treemapItems]; // Already sorted by value descending
    
    // Simple slice-and-dice algorithm
    function subdivide(
      itemsToLayout: typeof treemapItems,
      x: number,
      y: number,
      width: number,
      height: number
    ) {
      if (itemsToLayout.length === 0 || width <= 0 || height <= 0) return;
      
      if (itemsToLayout.length === 1) {
        rects.push({ x, y, width, height, item: itemsToLayout[0] });
        return;
      }
      
      const totalValue = itemsToLayout.reduce((sum, item) => sum + item.value, 0);
      
      if (itemsToLayout.length === 2) {
        const ratio = itemsToLayout[0].value / totalValue;
        // Always split along the longer axis
        if (width >= height) {
          const splitW = width * ratio;
          rects.push({ x, y, width: splitW, height, item: itemsToLayout[0] });
          rects.push({ x: x + splitW, y, width: width - splitW, height, item: itemsToLayout[1] });
        } else {
          const splitH = height * ratio;
          rects.push({ x, y, width, height: splitH, item: itemsToLayout[0] });
          rects.push({ x, y: y + splitH, width, height: height - splitH, item: itemsToLayout[1] });
        }
        return;
      }
      
      // For 3+ items: split into two groups
      // Find the best split point
      let bestSplit = 1;
      let bestRatio = 0;
      let runningSum = 0;
      
      for (let i = 0; i < itemsToLayout.length - 1; i++) {
        runningSum += itemsToLayout[i].value;
        const ratio = runningSum / totalValue;
        // We want the first group to be around 50-70% for a nice layout
        if (ratio >= 0.4 && ratio <= 0.75) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestSplit = i + 1;
          }
        }
      }
      
      // If no good split found, just take the first item
      if (bestRatio === 0) {
        bestSplit = 1;
        bestRatio = itemsToLayout[0].value / totalValue;
      }
      
      const firstGroup = itemsToLayout.slice(0, bestSplit);
      const secondGroup = itemsToLayout.slice(bestSplit);
      const firstValue = firstGroup.reduce((sum, item) => sum + item.value, 0);
      const firstRatio = firstValue / totalValue;
      
      // Split along the longer axis
      if (width >= height) {
        // Horizontal split - first group on left
        const splitW = width * firstRatio;
        subdivide(firstGroup, x, y, splitW, height);
        subdivide(secondGroup, x + splitW, y, width - splitW, height);
      } else {
        // Vertical split - first group on top
        const splitH = height * firstRatio;
        subdivide(firstGroup, x, y, width, splitH);
        subdivide(secondGroup, x, y + splitH, width, height - splitH);
      }
    }
    
    subdivide(items, 0, 0, 100, 100);
    return rects;
  }, [treemapItems, total]);

  if (treemapItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
        No liquidation data available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--text-secondary)]">Assets: <span className="text-[var(--text-primary)] font-medium">{treemapItems.length}</span></span>
        <span className="text-[var(--text-secondary)]">Total Liquidations: <span className="text-[var(--text-primary)] font-medium">{formatCurrency(total)}</span></span>
      </div>
      
      {/* Treemap container */}
      <div 
        className="relative w-full h-80 md:h-[400px] rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-base)]"
        onMouseLeave={() => setHoveredItem(null)}
      >
        {calculateTreemap.map((rect, index) => {
          // Calculate font size based on rectangle dimensions (not just area)
          const area = rect.width * rect.height;
          const minDim = Math.min(rect.width, rect.height);
          
          // Dynamic font sizing based on both area and smallest dimension
          let symbolSize = 'text-sm';
          let valueSize = 'text-xs';
          let showValue = true;
          let showSymbol = true;
          
          if (area > 3000 && minDim > 30) {
            symbolSize = 'text-4xl';
            valueSize = 'text-xl';
          } else if (area > 1500 && minDim > 25) {
            symbolSize = 'text-3xl';
            valueSize = 'text-lg';
          } else if (area > 800 && minDim > 20) {
            symbolSize = 'text-2xl';
            valueSize = 'text-base';
          } else if (area > 400 && minDim > 15) {
            symbolSize = 'text-xl';
            valueSize = 'text-sm';
          } else if (area > 150 && minDim > 10) {
            symbolSize = 'text-lg';
            valueSize = 'text-xs';
          } else if (area > 50) {
            symbolSize = 'text-base';
            showValue = false;
          } else {
            symbolSize = 'text-xs';
            showValue = false;
            if (area < 20) showSymbol = false;
          }
          
          return (
            <div
              key={`${rect.item.symbol}-${index}`}
              className="absolute flex flex-col items-center justify-center text-white transition-all hover:brightness-110 cursor-default overflow-hidden"
              style={{
                left: `${rect.x}%`,
                top: `${rect.y}%`,
                width: `${rect.width}%`,
                height: `${rect.height}%`,
                backgroundColor: rect.item.color,
                borderRight: '2px solid rgba(20,19,16,0.8)',
                borderBottom: '2px solid rgba(20,19,16,0.8)',
              }}
              onMouseEnter={(e) => {
                const containerRect = e.currentTarget.parentElement?.getBoundingClientRect();
                const elemRect = e.currentTarget.getBoundingClientRect();
                if (containerRect) {
                  setHoveredItem({
                    symbol: rect.item.symbol,
                    total: rect.item.value,
                    long: rect.item.long,
                    short: rect.item.short,
                    dominantSide: rect.item.dominantSide,
                    x: elemRect.left - containerRect.left + elemRect.width / 2,
                    y: elemRect.top - containerRect.top + elemRect.height / 2
                  });
                }
              }}
            >
              {showSymbol && (
                <div className={`font-bold ${symbolSize} drop-shadow-md truncate max-w-full px-1`}>{rect.item.symbol}</div>
              )}
              {showValue && (
                <div className={`font-semibold ${valueSize} drop-shadow-md truncate max-w-full px-1`}>{formatCurrency(rect.item.value)}</div>
              )}
            </div>
          );
        })}
        
        {/* Hover Tooltip */}
        {hoveredItem && (
          <div 
            className="absolute z-20 pointer-events-none bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-2 shadow-xl text-xs"
            style={{
              left: hoveredItem.x,
              top: hoveredItem.y,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className="font-bold text-[var(--text-primary)] mb-1">{hoveredItem.symbol}</div>
            <div className="space-y-0.5">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-secondary)]">Total:</span>
                <span className="text-[var(--text-primary)] font-medium">{formatCurrency(hoveredItem.total)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-secondary)]">Long:</span>
                <span className="font-medium" style={{ color: COLORS.long }}>{formatCurrency(hoveredItem.long)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-secondary)]">Short:</span>
                <span className="font-medium" style={{ color: COLORS.short }}>{formatCurrency(hoveredItem.short)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--text-secondary)]">Type:</span>
                <span className="font-medium" style={{ color: hoveredItem.dominantSide === 'SHORT' ? COLORS.short : COLORS.long }}>
                  {hoveredItem.dominantSide}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.long }} />
          <span className="text-[var(--text-secondary)]">Longs Dominant</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: COLORS.short }} />
          <span className="text-[var(--text-secondary)]">Shorts Dominant</span>
        </div>
      </div>
    </div>
  );
}

// Period selector component
function PeriodSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 md:gap-1 bg-[var(--bg-muted)] rounded-lg p-0.5 md:p-1 shrink-0">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={`px-2 md:px-3 py-1 text-xs md:text-sm font-medium rounded transition-colors ${
            value === p.value
              ? 'bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-color)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// Coin selector dropdown
function CoinSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-muted)] rounded-lg border border-[var(--border-color)] hover:border-[var(--text-secondary)] transition-colors"
      >
        <span className="font-medium text-[var(--text-primary)]">{value}</span>
        <ChevronDown size={16} className="text-[var(--text-secondary)]" />
      </button>
      
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 bg-[var(--bg-base)] border border-[var(--border-color)] rounded-lg shadow-lg py-1 min-w-[120px]">
            {COINS.map((coin) => (
              <button
                key={coin}
                onClick={() => { onChange(coin); setOpen(false); }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-muted)] transition-colors ${
                  value === coin ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'
                }`}
              >
                {coin}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Custom tooltip for charts - compact version
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  
  return (
    <div className="bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-2 shadow-xl text-xs min-w-[160px]">
      <div className="text-[var(--text-secondary)] mb-1">
        {new Date(label).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </div>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center justify-between gap-3">
          <span style={{ color: entry.color }}>{entry.name}:</span>
          <span className="font-medium text-[var(--text-primary)]">{formatCurrency(Math.abs(entry.value))}</span>
        </div>
      ))}
    </div>
  );
}

export default function LiquidationsPage() {
  // State
  const [treemapPeriod, setTreemapPeriod] = useState('24h');
  const [chartPeriod, setChartPeriod] = useState('all');
  const [summaryPeriod, setSummaryPeriod] = useState('7d');
  const [marketPeriod, setMarketPeriod] = useState('all');
  const [selectedCoin, setSelectedCoin] = useState('BTC');
  const [featuredFilter, setFeaturedFilter] = useState('ALL');
  const [chartRange, setChartRange] = useState({ start: 0, end: 100 });
  
  // Data state
  const [treemapData, setTreemapData] = useState<any>(null);
  const [chartData, setChartData] = useState<any>(null);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [marketData, setMarketData] = useState<any>(null);
  const [featuredData, setFeaturedData] = useState<any>(null);
  
  // Loading states
  const [loading, setLoading] = useState({
    treemap: true,
    chart: true,
    summary: true,
    market: true,
    featured: true,
  });

  // Fetch treemap data
  useEffect(() => {
    setLoading(l => ({ ...l, treemap: true }));
    analytics.getLiquidationsTreemap(treemapPeriod)
      .then(setTreemapData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, treemap: false })));
  }, [treemapPeriod]);

  // Fetch chart data
  useEffect(() => {
    setLoading(l => ({ ...l, chart: true }));
    setChartRange({ start: 0, end: 100 }); // Reset range on period change
    analytics.getLiquidationsLongShortChart(chartPeriod)
      .then(setChartData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, chart: false })));
  }, [chartPeriod]);

  // Slice chart data by range
  const slicedChartData = useMemo(() => {
    if (!chartData?.data?.length) return [];
    const data = chartData.data;
    const startIdx = Math.floor((chartRange.start / 100) * data.length);
    const endIdx = Math.ceil((chartRange.end / 100) * data.length);
    return data.slice(startIdx, Math.max(startIdx + 1, endIdx));
  }, [chartData, chartRange]);

  // Fetch summary data
  useEffect(() => {
    setLoading(l => ({ ...l, summary: true }));
    analytics.getLiquidationsSummary(selectedCoin, summaryPeriod)
      .then(setSummaryData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, summary: false })));
  }, [selectedCoin, summaryPeriod]);

  // Fetch market data
  useEffect(() => {
    setLoading(l => ({ ...l, market: true }));
    analytics.getLiquidationsMarket(selectedCoin, marketPeriod)
      .then(setMarketData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, market: false })));
  }, [selectedCoin, marketPeriod]);

  // Fetch featured liquidations
  useEffect(() => {
    setLoading(l => ({ ...l, featured: true }));
    analytics.getLiquidationsFeatured(10, featuredFilter === 'ALL' ? undefined : featuredFilter)
      .then(setFeaturedData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, featured: false })));
  }, [featuredFilter]);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <h1 className="text-3xl font-bold text-[var(--text-primary)]">Liquidations</h1>

      {/* Row 1: Treemap + Liquidations Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Treemap Section */}
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Liquidations by Asset</h2>
            <PeriodSelector value={treemapPeriod} onChange={setTreemapPeriod} />
          </div>
          
          {loading.treemap ? (
            <div className="h-80 md:h-[400px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
            </div>
          ) : treemapData ? (
            <LiquidationTreemap 
              data={treemapData.data} 
              totalValue={treemapData.totalValue} 
              assets={treemapData.assets} 
            />
          ) : null}
        </div>

        {/* Liquidations Summary */}
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Liquidations Summary</h2>
            <div className="flex items-center gap-2">
              <CoinSelector value={selectedCoin} onChange={setSelectedCoin} />
              <PeriodSelector value={summaryPeriod} onChange={setSummaryPeriod} />
            </div>
          </div>
          
          {loading.summary ? (
            <div className="h-72 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
            </div>
          ) : summaryData ? (
            <div className="space-y-3">
              {/* Total Liquidations */}
              <div className="p-3 md:p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)]">
                <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-1">TOTAL LIQUIDATIONS</div>
                <div className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">
                  {formatNumber(summaryData.totalCount, 0)} trades
                </div>
                <div className="text-xs md:text-sm text-[var(--text-secondary)]">
                  {formatCurrency(summaryData.totalValue)}
                </div>
              </div>

              {/* Long Liquidations */}
              <div className="p-3 md:p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)]">
                <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-1">LONG LIQUIDATIONS</div>
                <div className="text-xl md:text-2xl font-bold" style={{ color: COLORS.long }}>
                  {formatCurrency(summaryData.longValue)}
                </div>
                <div className="text-xs md:text-sm text-[var(--text-secondary)]">
                  {summaryData.longPercent.toFixed(2)}%
                </div>
              </div>

              {/* Short Liquidations */}
              <div className="p-3 md:p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)]">
                <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-1">SHORT LIQUIDATIONS</div>
                <div className="text-xl md:text-2xl font-bold" style={{ color: COLORS.short }}>
                  {formatCurrency(summaryData.shortValue)}
                </div>
                <div className="text-xs md:text-sm text-[var(--text-secondary)]">
                  {summaryData.shortPercent.toFixed(2)}%
                </div>
              </div>

              {/* Largest Liquidation */}
              <div className="p-3 md:p-4 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)]">
                <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-1">LARGEST LIQUIDATION</div>
                <div className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">
                  {formatNumber(summaryData.largestSize, 2)} {selectedCoin}
                </div>
                <div className="text-xs md:text-sm text-[var(--text-secondary)]">
                  {formatCurrency(summaryData.largestValue)}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Row 2: Chart + Market Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Chart Section */}
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Total Liquidations Chart</h2>
            <PeriodSelector value={chartPeriod} onChange={setChartPeriod} />
          </div>
          
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 md:gap-6 text-xs md:text-sm mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded" style={{ backgroundColor: COLORS.long }} />
              <span className="text-[var(--text-secondary)]">Long</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded" style={{ backgroundColor: COLORS.short }} />
              <span className="text-[var(--text-secondary)]">Short</span>
            </div>
          </div>
          
          {loading.chart ? (
            <div className="h-80 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
            </div>
          ) : chartData?.data?.length > 0 ? (
            <div className="space-y-0">
              {/* Main Chart - uses sliced data */}
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={slicedChartData.map((d: any) => ({
                      ...d,
                      shortValueNegative: -d.shortValue
                    }))} 
                    margin={{ top: 10, right: 10, bottom: 5, left: 10 }}
                  >
                    <XAxis 
                      dataKey="timestamp" 
                      tickFormatter={(ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                      axisLine={{ stroke: 'var(--border-color)' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      tickFormatter={(v) => formatCompact(Math.abs(v))}
                      tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                      axisLine={{ stroke: 'var(--border-color)' }}
                      tickLine={false}
                      width={55}
                    />
                    <Tooltip 
                      content={<ChartTooltip />} 
                      cursor={{ fill: 'var(--bg-secondary-20)' }}
                    />
                    <ReferenceLine y={0} stroke="var(--text-secondary)" strokeWidth={1} />
                    {/* Both bars share the same stackId so they render in one column,
                        both emanating from y=0 — Long upward, Short downward.
                        Works at any density (sparse ALL view or dense 4H view). */}
                    <Bar dataKey="longValue" name="Long" stackId="ls" fill={COLORS.long} maxBarSize={30} />
                    <Bar dataKey="shortValueNegative" name="Short" stackId="ls" fill={COLORS.short} maxBarSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              
              {/* Interactive Range Slider */}
              <div className="pt-2">
                <LiquidationRangeSlider 
                  data={chartData.data}
                  rangeStart={chartRange.start}
                  rangeEnd={chartRange.end}
                  onRangeChange={(start, end) => setChartRange({ start, end })}
                />
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-[var(--text-secondary)]">
              No chart data available
            </div>
          )}
        </div>

        {/* Market Summary */}
        <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6 overflow-hidden">
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)] whitespace-nowrap">Market Summary</h2>
              <CoinSelector value={selectedCoin} onChange={setSelectedCoin} />
            </div>
            <div className="overflow-x-auto -mx-1 px-1">
              <PeriodSelector value={marketPeriod} onChange={setMarketPeriod} />
            </div>
          </div>
          
          {loading.market ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
            </div>
          ) : marketData ? (
            <div className="space-y-4">
              {/* Dominant badge */}
              <div 
                className="inline-block px-3 py-1 rounded-md text-sm font-medium"
                style={{ 
                  backgroundColor: marketData.dominant === 'LONGS' ? `${COLORS.long}20` : `${COLORS.short}20`,
                  color: marketData.dominant === 'LONGS' ? COLORS.long : COLORS.short
                }}
              >
                {marketData.dominant} DOMINANT
              </div>

              {/* Price and Value row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-1">Current Market Price</div>
                  <div className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">
                    ${formatNumber(marketData.markPrice, 0)}
                  </div>
                </div>
                <div>
                  <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-1">USD Value of Liquidations</div>
                  <div className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">
                    {formatCurrency(marketData.totalValue)}
                  </div>
                </div>
              </div>

              {/* Density and Trend row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-2">Liquidation Density</div>
                  <div className="space-y-1">
                    <div className="text-xs md:text-sm" style={{ color: COLORS.long }}>
                      LONGS: {formatNumber(marketData.longCount, 0)} liquidations
                    </div>
                    <div className="text-xs md:text-sm" style={{ color: COLORS.short }}>
                      SHORTS: {formatNumber(marketData.shortCount, 0)} liquidations
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-1">Price Trend (24h)</div>
                  <div className={`text-xl md:text-2xl font-bold flex items-center gap-2 ${
                    marketData.priceChange24h >= 0 ? 'text-[var(--bids)]' : 'text-[var(--asks)]'
                  }`}>
                    {marketData.priceChange24h >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                    {marketData.priceChange24h >= 0 ? '+' : ''}{marketData.priceChange24h.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* L/S Distribution bar */}
              <div>
                <div className="text-xs md:text-sm text-[var(--text-secondary)] mb-2">L/S Notional Distribution</div>
                <div className="h-3 rounded-full overflow-hidden flex">
                  <div 
                    style={{ width: `${marketData.longPercent}%`, backgroundColor: COLORS.long }}
                    className="transition-all duration-500"
                  />
                  <div 
                    style={{ width: `${marketData.shortPercent}%`, backgroundColor: COLORS.short }}
                    className="transition-all duration-500"
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs">
                  <div style={{ color: COLORS.long }}>
                    {marketData.longPercent.toFixed(2)}% LONGS<br />
                    <span className="text-[var(--text-secondary)]">{formatCurrency(marketData.longValue)}</span>
                  </div>
                  <div className="text-right" style={{ color: COLORS.short }}>
                    {marketData.shortPercent.toFixed(2)}% SHORTS<br />
                    <span className="text-[var(--text-secondary)]">{formatCurrency(marketData.shortValue)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Row 3: Featured Liquidations Table */}
      <div className="bg-[var(--bg-muted)] rounded-xl border border-[var(--border-color)] p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <h2 className="text-base md:text-lg font-semibold text-[var(--text-primary)]">Featured Liquidations</h2>
          <div className="flex items-center gap-2 bg-[var(--bg-base)] rounded-lg border border-[var(--border-color)] px-3 py-1.5">
            <select
              value={featuredFilter}
              onChange={(e) => setFeaturedFilter(e.target.value)}
              className="bg-transparent text-sm text-[var(--text-primary)] outline-none cursor-pointer"
            >
              <option value="ALL">ALL</option>
              {COINS.map(coin => (
                <option key={coin} value={coin}>{coin}</option>
              ))}
            </select>
          </div>
        </div>
        
        {loading.featured ? (
          <div className="h-48 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]" />
          </div>
        ) : featuredData?.data?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs md:text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                  <th className="pb-3 font-medium">ASSET</th>
                  <th className="pb-3 font-medium">POSITION SIZE</th>
                  <th className="pb-3 font-medium">LIQUIDATION PRICE</th>
                  <th className="pb-3 font-medium">WALLET</th>
                </tr>
              </thead>
              <tbody>
                {featuredData.data.map((liq: any) => (
                  <tr key={liq.id} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-base)] transition-colors">
                    <td className="py-3 md:py-4">
                      <div className="flex items-center gap-2 md:gap-3">
                        <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-[var(--bg-base)] flex items-center justify-center text-xs md:text-sm font-medium">
                          {liq.symbol.charAt(0)}
                        </div>
                        <span className="font-medium text-sm md:text-base text-[var(--text-primary)]">{liq.symbol}</span>
                      </div>
                    </td>
                    <td className="py-3 md:py-4">
                      <div className="font-medium text-sm md:text-base text-[var(--text-primary)]">{formatCurrency(liq.value)}</div>
                      {liq.isHighImpact && (
                        <div className="flex items-center gap-1 text-xs text-[var(--asks)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--asks)]" />
                          HIGH IMPACT
                        </div>
                      )}
                    </td>
                    <td className="py-3 md:py-4">
                      <div className={`font-medium text-sm md:text-base ${liq.side === 'long' ? 'text-[var(--bids)]' : 'text-[var(--asks)]'}`}>
                        ${formatNumber(liq.price, 2)}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] uppercase">{liq.side}</div>
                    </td>
                    <td className="py-3 md:py-4">
                      <a 
                        href={`/whales/${liq.wallet}`}
                        className="text-xs md:text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors flex items-center gap-1"
                      >
                        {formatAddress(liq.wallet)}
                        <ExternalLink size={12} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-[var(--text-secondary)]">
            No featured liquidations available
          </div>
        )}
      </div>
    </div>
  );
}
