'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { analytics, formatCurrency, formatCompact, formatAddress, formatNumber, cn } from '@/lib/api';
import { 
  ComposedChart, Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  Cell, ReferenceLine, Legend
} from 'recharts';
import { Flame, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { CoinPicker } from '@/components/CoinPicker';
import { HIDDEN_COINS } from '@/lib/coins';
import { ChartFrame } from '@/components/ChartFrame';
import { useCurrentNetwork } from '@/hooks/useCurrentNetwork';

// Time period options
const PERIODS = [
  { label: '4H', value: '4h' },
  { label: 'D', value: '24h' },
  { label: 'W', value: '7d' },
  { label: '3D', value: '3d' },
  { label: 'ALL', value: 'all' },
];

// Note: the old `const COINS = ['BTC', 'ETH', 'SOL']` was removed. This page
// now pulls the live market list via `useAvailableCoins()` inside the main
// component and passes it down to the single-coin pickers and featured filter.
// The period array ordering was kept as-is to match existing UI.

// Colors
const COLORS = {
  long: 'var(--pos)',  // Green (bids)
  short: 'var(--neg)', // Red (asks)
  BTC: 'var(--coin-3)',
  ETH: 'var(--coin-1)',
  SOL: 'var(--coin-5)',
  XRP: 'var(--coin-4)',
  GOLD: 'var(--coin-2)',
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

// ----------------------------------------------------------------------------
// Liquidation Treemap
//
// Uses a **squarified** treemap layout (Bruls, Huijsen, van Wijk 2000), the
// same algorithm Hyperliquid uses for this view. Squarification minimizes the
// aspect ratio of each cell (rectangles stay close to 1:1), which is far more
// readable than slice-and-dice — especially when the top item dominates and
// the tail has a long list of tiny coins.
//
// Compared to the previous implementation this fixes three concrete issues:
//   1. Long thin slivers for small coins (caused labels to truncate to "X...")
//      — squarified layout produces small-but-square cells instead.
//   2. Tooltip running off the edge of the card when hovering a corner cell
//      — tooltip now clamps its position against the container bounds.
//   3. Brittle font-size tiers based on arbitrary area thresholds
//      — sizes are now computed from the cell's actual pixel dimensions.
// ----------------------------------------------------------------------------
function LiquidationTreemap({
  data,
  totalValue,
  assets,
}: {
  data: { symbol: string; side: string; value: number; count: number }[];
  totalValue: number;
  assets: number;
}) {
  // Hovered cell state for the tooltip. `rect` is carried so we can clamp the
  // tooltip against the container edges (see tooltip rendering below).
  const [hoveredItem, setHoveredItem] = useState<{
    symbol: string;
    total: number;
    long: number;
    short: number;
    dominantSide: string;
    rect: { x: number; y: number; width: number; height: number };
  } | null>(null);

  // Container size drives the squarification math (we need pixel dimensions).
  // We read it from a ref + ResizeObserver so the layout reflows when the
  // card resizes (responsive).
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Group raw liquidation events by symbol. Each cell's color is determined
  // by which side (long vs short) has more cumulative liquidation value.
  const treemapItems = useMemo(() => {
    const groups: Record<string, { long: number; short: number; total: number }> = {};
    const hiddenSet = new Set(HIDDEN_COINS);
    for (const item of data) {
      // Drop hidden symbols (e.g. XAU) so they don't appear as treemap cells.
      if (hiddenSet.has(item.symbol)) continue;
      if (!groups[item.symbol]) groups[item.symbol] = { long: 0, short: 0, total: 0 };
      if (item.side === 'long') groups[item.symbol].long += item.value;
      else groups[item.symbol].short += item.value;
      groups[item.symbol].total += item.value;
    }
    return Object.entries(groups)
      .map(([symbol, values]) => ({
        symbol,
        value: values.total,
        long: values.long,
        short: values.short,
        color: values.short >= values.long ? COLORS.short : COLORS.long,
        dominantSide: values.short >= values.long ? 'SHORT' : 'LONG',
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const total = useMemo(
    () => treemapItems.reduce((sum, item) => sum + item.value, 0),
    [treemapItems]
  );

  // Squarified treemap layout. Returns one rect per item in ABSOLUTE PIXELS
  // (not percentages) so the label-sizing logic below can reason about space.
  const rects = useMemo(() => {
    if (treemapItems.length === 0 || total === 0) return [];
    if (containerSize.w === 0 || containerSize.h === 0) return [];

    interface Rect {
      x: number;
      y: number;
      width: number;
      height: number;
      item: typeof treemapItems[0];
    }
    const out: Rect[] = [];

    // Scale item values → target area in pixels so the total area equals
    // the container area. Each item's rect area will be proportional to its
    // share of the total.
    const totalArea = containerSize.w * containerSize.h;
    const scaled = treemapItems.map(it => ({
      item: it,
      area: (it.value / total) * totalArea,
    }));

    // `squarify` — classic algorithm: process items in descending order,
    // accumulate them into a "row" that runs along the SHORTER side of the
    // remaining free rectangle. At each step check whether adding the next
    // item would make the worst aspect ratio in the row better or worse.
    // If worse, emit the current row and start a new one with the new item.
    function squarify(
      items: { item: typeof treemapItems[0]; area: number }[],
      x: number,
      y: number,
      w: number,
      h: number
    ) {
      if (items.length === 0 || w <= 0 || h <= 0) return;

      // `worst` returns the maximum of longest/shortest aspect ratios for a
      // row of given sizes laid along side `side`. Lower = more square-ish.
      const worst = (sizes: number[], side: number): number => {
        if (sizes.length === 0) return Infinity;
        const s = sizes.reduce((a, b) => a + b, 0);
        const sMax = Math.max(...sizes);
        const sMin = Math.min(...sizes);
        const sideSq = side * side;
        const sSq = s * s;
        return Math.max((sideSq * sMax) / sSq, sSq / (sideSq * sMin));
      };

      const remaining = [...items];
      while (remaining.length > 0) {
        const side = Math.min(w, h); // row runs along the shorter dimension
        const row: typeof remaining = [];
        let rowSizes: number[] = [];
        let currentWorst = Infinity;

        // Greedily add items to the row while aspect ratio improves.
        while (remaining.length > 0) {
          const trySizes = [...rowSizes, remaining[0].area];
          const tryWorst = worst(trySizes, side);
          if (row.length === 0 || tryWorst <= currentWorst) {
            row.push(remaining.shift()!);
            rowSizes = trySizes;
            currentWorst = tryWorst;
          } else {
            break;
          }
        }

        // Lay out the finalized row. Total area of the row determines its
        // thickness along the LONG axis; items within split along the SHORT axis.
        const rowArea = rowSizes.reduce((a, b) => a + b, 0);
        if (w >= h) {
          // Row is a vertical stripe on the left; items stack top-to-bottom.
          const stripeW = rowArea / h;
          let yy = y;
          for (let i = 0; i < row.length; i++) {
            const cellH = rowSizes[i] / stripeW;
            out.push({ x, y: yy, width: stripeW, height: cellH, item: row[i].item });
            yy += cellH;
          }
          x += stripeW;
          w -= stripeW;
        } else {
          // Row is a horizontal stripe on top; items run left-to-right.
          const stripeH = rowArea / w;
          let xx = x;
          for (let i = 0; i < row.length; i++) {
            const cellW = rowSizes[i] / stripeH;
            out.push({ x: xx, y, width: cellW, height: stripeH, item: row[i].item });
            xx += cellW;
          }
          y += stripeH;
          h -= stripeH;
        }
      }
    }

    squarify(scaled, 0, 0, containerSize.w, containerSize.h);
    return out;
  }, [treemapItems, total, containerSize]);

  if (treemapItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-secondary)]">
        No liquidation data available
      </div>
    );
  }

  // Edge-aware tooltip placement. We prefer above-and-centered, but if that
  // would clip the top of the container we flip below; if the horizontal
  // center would clip left/right, we clamp to the card edges. This is what
  // fixes the "info goes kinda off" bug when you hover a corner cell.
  const TOOLTIP_W = 180; // approximate — enough for clamping math
  const TOOLTIP_H = 110;
  const tooltipPos = (() => {
    if (!hoveredItem || containerSize.w === 0) return null;
    const r = hoveredItem.rect;
    const cellCenterX = r.x + r.width / 2;
    const preferredLeft = cellCenterX - TOOLTIP_W / 2;
    const left = Math.max(8, Math.min(containerSize.w - TOOLTIP_W - 8, preferredLeft));
    // Try to place just above the cell; flip below if there isn't room.
    const above = r.y - TOOLTIP_H - 6;
    const below = r.y + r.height + 6;
    const top = above >= 8 ? above : below + TOOLTIP_H <= containerSize.h - 8 ? below : Math.max(8, r.y);
    return { left, top };
  })();

  return (
    <div className="space-y-3">
      {/* Header row — matches the Hyperliquid layout: "Assets: N" on the left,
          "Total Liquidations: $X" on the right. */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--text-secondary)]">
          Assets: <span className="text-[var(--text-primary)] font-medium">{treemapItems.length}</span>
        </span>
        <span className="text-[var(--text-secondary)]">
          Total Liquidations: <span className="text-[var(--text-primary)] font-medium">{formatCurrency(total)}</span>
        </span>
      </div>

      {/* Treemap container. Height is fixed so the squarification math has
          something stable to work with; width is 100% of the parent card. */}
      <div
        ref={containerRef}
        className="relative w-full h-80 md:h-[400px] rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-base)]"
        onMouseLeave={() => setHoveredItem(null)}
      >
        {rects.map((rect) => {
          // Label sizing based on available pixels. We want:
          //   - large cells (BTC when dominant): big symbol + value
          //   - medium cells: moderate symbol + value
          //   - small cells: small symbol only, no value (value shown on hover)
          //   - tiny cells: no labels at all (color only)
          //
          // The thresholds are pixel-based so they stay correct at any
          // container size, unlike the old percentage/area mixed heuristic.
          const minDim = Math.min(rect.width, rect.height);
          const maxDim = Math.max(rect.width, rect.height);

          let symbolPx = 0;
          let valuePx = 0;
          let showValue = false;

          if (minDim >= 80 && maxDim >= 120) {
            symbolPx = 40;
            valuePx = 24;
            showValue = true;
          } else if (minDim >= 60) {
            symbolPx = 26;
            valuePx = 16;
            showValue = true;
          } else if (minDim >= 40) {
            symbolPx = 18;
            valuePx = 12;
            showValue = true;
          } else if (minDim >= 24) {
            symbolPx = 14;
            showValue = false;
          } else if (minDim >= 14) {
            symbolPx = 11;
            showValue = false;
          } else {
            // Too small for any text — show hover-only.
            symbolPx = 0;
            showValue = false;
          }

          return (
            <div
              key={rect.item.symbol}
              className="absolute flex flex-col items-center justify-center text-white transition-[filter,transform] duration-150 hover:brightness-110 cursor-default overflow-hidden select-none"
              style={{
                left: `${rect.x}px`,
                top: `${rect.y}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                backgroundColor: rect.item.color,
                // Thin dark rule between cells so borders are visible over
                // same-color neighbors.
                boxShadow: 'inset -1px -1px 0 rgba(20,19,16,0.9), inset 0 0 0 0.5px rgba(20,19,16,0.2)',
              }}
              onMouseEnter={() => {
                setHoveredItem({
                  symbol: rect.item.symbol,
                  total: rect.item.value,
                  long: rect.item.long,
                  short: rect.item.short,
                  dominantSide: rect.item.dominantSide,
                  rect,
                });
              }}
            >
              {symbolPx > 0 && (
                <div
                  className="font-bold drop-shadow-md truncate max-w-full px-2 leading-tight"
                  style={{ fontSize: `${symbolPx}px` }}
                >
                  {rect.item.symbol}
                </div>
              )}
              {showValue && (
                <div
                  className="font-semibold drop-shadow-md truncate max-w-full px-2 leading-tight mt-0.5"
                  style={{ fontSize: `${valuePx}px` }}
                >
                  {formatCurrency(rect.item.value)}
                </div>
              )}
            </div>
          );
        })}

        {/* Hover Tooltip — positioned with edge clamping. The `tooltipPos`
            math above keeps it fully inside the card even for corner cells,
            which was the "info goes kinda off" bug from the old version. */}
        {hoveredItem && tooltipPos && (
          <div
            className="absolute z-20 pointer-events-none bg-[var(--bg-muted)] border border-[var(--border-color)] rounded-lg p-2 shadow-xl text-xs"
            style={{
              left: `${tooltipPos.left}px`,
              top: `${tooltipPos.top}px`,
              width: `${TOOLTIP_W}px`,
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
                <span
                  className="font-medium"
                  style={{ color: hoveredItem.dominantSide === 'SHORT' ? COLORS.short : COLORS.long }}
                >
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

// Note: the local `SingleCoinDropdown` was removed. Both uses on this page
// (Liquidations Summary and Featured Liquidations filter) now use the shared
// `<CoinPicker>` component so all three coin pickers across the site share
// the same visual language — bold defaults, search box, colored swatches.

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
  // `useAvailableCoins` is no longer called here — the two coin pickers
  // (<CoinPicker> for Summary and for Featured filter) each call the hook
  // themselves internally. Module-level caching in the hook means there's
  // still only one network request per session.

  // State
  // Refetch all liquidation data when the network changes.
  const { network } = useCurrentNetwork();

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
  }, [treemapPeriod, network]);

  // Fetch chart data
  useEffect(() => {
    setLoading(l => ({ ...l, chart: true }));
    setChartRange({ start: 0, end: 100 }); // Reset range on period change
    analytics.getLiquidationsLongShortChart(chartPeriod)
      .then(setChartData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, chart: false })));
  }, [chartPeriod, network]);

  // Slice chart data by range
  const slicedChartData = useMemo(() => {
    if (!chartData?.data?.length) return [];
    const data = chartData.data;
    const startIdx = Math.floor((chartRange.start / 100) * data.length);
    const endIdx = Math.ceil((chartRange.end / 100) * data.length);
    return data.slice(startIdx, Math.max(startIdx + 1, endIdx));
  }, [chartData, chartRange]);

  // Symmetric Y-axis domain so the Long (positive) and Short (negative) bars
  // share the same zero baseline and the same visual scale, regardless of which
  // side has larger values. Used by both yAxisIds below.
  const chartYDomain = useMemo((): [number, number] => {
    if (!slicedChartData.length) return [-1, 1];
    let max = 0;
    for (const d of slicedChartData) {
      const l = Math.abs(d.longValue || 0);
      const s = Math.abs(d.shortValue || 0);
      if (l > max) max = l;
      if (s > max) max = s;
    }
    // Add 10% headroom so bars don't touch the top/bottom
    const padded = max * 1.1 || 1;
    return [-padded, padded];
  }, [slicedChartData]);

  // Fetch summary data
  useEffect(() => {
    setLoading(l => ({ ...l, summary: true }));
    analytics.getLiquidationsSummary(selectedCoin, summaryPeriod)
      .then(setSummaryData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, summary: false })));
  }, [selectedCoin, summaryPeriod, network]);

  // Fetch market data
  useEffect(() => {
    setLoading(l => ({ ...l, market: true }));
    analytics.getLiquidationsMarket(selectedCoin, marketPeriod)
      .then(setMarketData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, market: false })));
  }, [selectedCoin, marketPeriod, network]);

  // Fetch featured liquidations
  useEffect(() => {
    setLoading(l => ({ ...l, featured: true }));
    analytics.getLiquidationsFeatured(10, featuredFilter === 'ALL' ? undefined : featuredFilter)
      .then(setFeaturedData)
      .catch(console.error)
      .finally(() => setLoading(l => ({ ...l, featured: false })));
  }, [featuredFilter, network]);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <h1 className="page-title text-[var(--text-primary)]">Liquidations</h1>

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
              <CoinPicker value={selectedCoin} onChange={setSelectedCoin} />
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
                <ChartFrame title="Total Liquidations" className="h-full" legend={[{ label: 'Long', color: COLORS.long }, { label: 'Short', color: COLORS.short }]}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={slicedChartData.map((d: any) => ({
                      ...d,
                      shortValueNegative: -d.shortValue
                    }))} 
                    margin={{ top: 10, right: 10, bottom: 5, left: 10 }}
                    stackOffset="sign"
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
                      domain={chartYDomain}
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
                    {/* stackOffset="sign" on the chart tells Recharts to split stacks by sign:
                        positive values stack up from 0, negative values stack down from 0.
                        Combined with matching stackId, each bar in its own column emanates
                        from the 0 baseline — Long goes UP, Short goes DOWN, same x-slot. */}
                    <Bar dataKey="longValue"          name="Long"  stackId="ls" fill={COLORS.long}  maxBarSize={30} />
                    <Bar dataKey="shortValueNegative" name="Short" stackId="ls" fill={COLORS.short} maxBarSize={30} />
                  </BarChart>
                </ResponsiveContainer>
                </ChartFrame>
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
              <CoinPicker value={selectedCoin} onChange={setSelectedCoin} />
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
          {/* Same <CoinPicker> used by the Summary section above, but with
              includeAllOption so users can unfocus and see every coin's
              liquidations in the feed. All three coin pickers across the
              site now share one visual language. */}
          <CoinPicker
            value={featuredFilter}
            onChange={setFeaturedFilter}
            includeAllOption
            ariaLabel="Filter featured liquidations by coin"
          />
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
