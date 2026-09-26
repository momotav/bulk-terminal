'use client';

// InteractiveRangeSlider — a draggable timeline brush that sits under a chart
// and lets you pick an exact window (drag either handle, or grab the middle to
// pan). It renders a mini preview of the series behind the brush (bars for
// count/volume charts, line/area paths for metric charts) so you can see what
// you're selecting. Drag updates a local preview only; the parent range is
// committed on release, so the big chart doesn't thrash mid-drag.
//
// Extracted from the general analytics page so every page with a recorded
// time-series (general, network, …) can offer the same "choose the exact
// timeline" control.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/api';

// Take an index-window [start%, end%] of a series, always keeping at least two
// points so a chart never collapses to a single dot. Pair this with the slider:
// the slider reports [start, end] percentages, this slices the data to them.
export function sliceByRange<T>(arr: T[], start: number, end: number): T[] {
  if (arr.length < 2) return arr;
  const s = Math.max(0, Math.floor((start / 100) * arr.length));
  const e = Math.min(arr.length, Math.ceil((end / 100) * arr.length));
  return arr.slice(s, Math.max(s + 2, e));
}

export const InteractiveRangeSlider = ({
  data,
  color = 'var(--accent)',
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
              fill={lineColor}
              fillOpacity={0.19}
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
                  backgroundColor: color,
                  opacity: inRange ? 0.5 : 0.2,
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
          {/* Dimmed areas — scrim tinted with the theme base so it fades the
              out-of-range preview correctly in both light and dark. */}
          <div
            className="absolute top-0 bottom-0 left-0 pointer-events-none"
            style={{ width: `${displayStart}%`, background: 'rgb(var(--p-bg) / 0.62)' }}
          />
          <div
            className="absolute top-0 bottom-0 right-0 pointer-events-none"
            style={{ width: `${100 - displayEnd}%`, background: 'rgb(var(--p-bg) / 0.62)' }}
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
