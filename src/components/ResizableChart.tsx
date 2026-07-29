'use client';

// ----------------------------------------------------------------------------
// ResizableChart
//
// Wraps a single chart card and gives it a bottom-right corner grip (revealed
// on hover) that resizes the card on BOTH axes at once by dragging — width and
// height together — with a double-click to reset. Same corner-grip affordance
// as ResizableChartRow, for pages laid out as a single column of full-width
// charts (e.g. Staking) where there's no neighbor to trade width with:
//   - height: the chart body's height, exposed as the `--chart-h` CSS variable
//     (the card reads it via h-[var(--chart-h,<default>px)])
//   - width:  the card's share of its container, from a minimum up to 100%
//     (dragging narrower just leaves space on the right — it can't push into a
//     neighbor the way a 2-up ResizableChartRow does)
// Both values are persisted per `storageKey` in localStorage, so a chart keeps
// its size across reloads. When this wrapper isn't present the `--chart-h`
// fallback keeps the card's original fixed height and it stays full-width.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_H = 180;
const MAX_H = 720;
const MIN_W = 40; // percent of the container — a wide time-series below this reads cramped
const MAX_W = 100;

type Size = { w: number; h: number };

function loadSize(key: string, fallback: Size): Size {
  try {
    const raw = localStorage.getItem(`chart-size:${key}`);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p?.w === 'number' && typeof p?.h === 'number') {
        return {
          w: Math.min(MAX_W, Math.max(MIN_W, p.w)),
          h: Math.min(MAX_H, Math.max(MIN_H, p.h)),
        };
      }
    }
  } catch {
    /* storage unavailable / corrupted — use the default */
  }
  return fallback;
}

function saveSize(key: string, s: Size): void {
  try {
    localStorage.setItem(`chart-size:${key}`, JSON.stringify(s));
  } catch {
    /* storage blocked — resizing still works for the session */
  }
}

export function ResizableChart({
  storageKey,
  defaultHeight = 288,
  children,
}: {
  storageKey: string;
  defaultHeight?: number;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: MAX_W, h: defaultHeight });
  const [dragging, setDragging] = useState(false);
  // Captured at pointer-down so each move applies a delta from the start point
  // (the grip's offset from the card edge would otherwise jump on first move).
  const start = useRef<{ x: number; y: number; size: Size; containerW: number } | null>(null);

  useEffect(() => {
    setSize(loadSize(storageKey, { w: MAX_W, h: defaultHeight }));
  }, [storageKey, defaultHeight]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const containerW = containerRef.current?.parentElement?.getBoundingClientRect().width ?? 1;
      start.current = { x: e.clientX, y: e.clientY, size, containerW };
      setDragging(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'nwse-resize';
    },
    [size],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    const s = start.current;
    const wPct = s.size.w + ((e.clientX - s.x) / s.containerW) * 100;
    const h = s.size.h + (e.clientY - s.y);
    setSize({
      w: Math.min(MAX_W, Math.max(MIN_W, wPct)),
      h: Math.min(MAX_H, Math.max(MIN_H, h)),
    });
  }, []);

  const endDrag = useCallback(() => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    setSize((cur) => {
      saveSize(storageKey, cur);
      return cur;
    });
  }, [storageKey]);

  const reset = useCallback(() => {
    const next = { w: MAX_W, h: defaultHeight };
    setSize(next);
    saveSize(storageKey, next);
  }, [defaultHeight, storageKey]);

  return (
    <div
      ref={containerRef}
      className="group/rh relative"
      style={{ width: `${size.w}%`, maxWidth: '100%', ['--chart-h' as string]: `${size.h}px` }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {children}
      <div
        role="button"
        aria-label="Resize chart"
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onDoubleClick={reset}
        className={
          'absolute bottom-1 right-1 z-20 w-5 h-5 cursor-nwse-resize ' +
          'flex items-end justify-end transition-opacity duration-200 ' +
          (dragging ? 'opacity-100' : 'opacity-0 group-hover/rh:opacity-60 hover:!opacity-100')
        }
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M13 5 L5 13 M13 9 L9 13 M13 1 L1 13"
            stroke={dragging ? 'var(--accent)' : 'var(--text-tertiary)'}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
