'use client';

// ----------------------------------------------------------------------------
// ResizableChart
//
// Wraps a single chart card and gives it a bottom-right corner grip (revealed
// on hover) that resizes the chart's HEIGHT by dragging — double-click resets.
// The chosen height is exposed to the card as the `--chart-h` CSS variable and
// persisted per `storageKey` in localStorage, so it survives reloads.
//
// This is the single-chart companion to ResizableChartRow: that component
// redistributes WIDTH between two side-by-side charts (used on pages laid out
// in 2-up rows), which can't apply to single-column pages like Staking. Height
// resize works uniformly on every layout, so every chart gets the same
// "change the size" affordance regardless of how the page is arranged.
//
// The card reads the height with `h-[var(--chart-h,<default>px)]`; when this
// wrapper isn't present the fallback keeps the original fixed height.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_H = 180;
const MAX_H = 720;

function loadHeight(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(`chart-h:${key}`);
    if (raw) {
      const v = parseInt(raw, 10);
      if (!Number.isNaN(v)) return Math.min(MAX_H, Math.max(MIN_H, v));
    }
  } catch {
    /* storage unavailable — use the default */
  }
  return fallback;
}

function saveHeight(key: string, h: number): void {
  try {
    localStorage.setItem(`chart-h:${key}`, String(h));
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
  const [h, setH] = useState(defaultHeight);
  const [dragging, setDragging] = useState(false);
  // Captured at pointer-down so each move applies a delta from the start point
  // (the grip's offset from the card edge would otherwise jump on first move).
  const start = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    setH(loadHeight(storageKey, defaultHeight));
  }, [storageKey, defaultHeight]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      start.current = { y: e.clientY, h };
      setDragging(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
    },
    [h],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current) return;
    const next = start.current.h + (e.clientY - start.current.y);
    setH(Math.min(MAX_H, Math.max(MIN_H, next)));
  }, []);

  const endDrag = useCallback(() => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    setH((cur) => {
      saveHeight(storageKey, cur);
      return cur;
    });
  }, [storageKey]);

  const reset = useCallback(() => {
    setH(defaultHeight);
    saveHeight(storageKey, defaultHeight);
  }, [defaultHeight, storageKey]);

  return (
    <div
      className="group/rh relative"
      style={{ ['--chart-h' as string]: `${h}px` }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {children}
      <div
        role="button"
        aria-label="Resize chart height"
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onDoubleClick={reset}
        className={
          'absolute bottom-1 right-1 z-20 w-5 h-5 cursor-ns-resize ' +
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
