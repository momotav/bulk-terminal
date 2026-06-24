'use client';

// ----------------------------------------------------------------------------
// ResizableChartRow
//
// A two-chart row where each chart carries resize handles (revealed on hover):
//   - inner vertical EDGE (the seam between the two charts) → width only
//       (this chart's share of the row; the neighbor takes the remainder, so
//        widths always sum to 100%)
//   - bottom EDGE → height only (the row's chart-body height; both charts
//       share one height)
//   - inner-bottom CORNER → both axes at once ("scale")
//
// Each axis has its own affordance so single-axis tweaks are precise; the
// corner stays for grabbing both. Cursor reflects the active axis
// (ew / ns / diagonal).
//
// Past 75% width the neighbor wraps to its own full-width row with an eased
// reflow; dragging back below 75% un-wraps it.
//
// Smoothness:
//  - During an active drag NO CSS transitions run — size tracks the cursor 1:1.
//  - Transitions fire only for discrete jumps: the wrap/unwrap reflow and
//    double-click resets, eased over 240ms.
//
// Only active on lg+ viewports; below that charts stack full-width and the
// handles are hidden.
// ----------------------------------------------------------------------------

import React, {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

const MIN_SPLIT = 25;
const MAX_SPLIT = 100;
const WRAP_AT = 75;
const MIN_H = 180;
const MAX_H = 640;
const DEFAULT_H = 260;
const GAP_PX = 16;

type DragMode = 'x' | 'y' | 'both';
type Persisted = { split: number; rowH: number };

function loadPersisted(key: string): Persisted | null {
  try {
    const raw = localStorage.getItem(`chart-row:${key}`);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.split === 'number' && typeof p?.rowH === 'number') return p;
  } catch {
    /* corrupted or unavailable storage */
  }
  return null;
}

function savePersisted(key: string, p: Persisted): void {
  try {
    localStorage.setItem(`chart-row:${key}`, JSON.stringify(p));
  } catch {
    /* storage blocked — resizing still works for the session */
  }
}

const baseHandle =
  'absolute z-20 transition-opacity duration-200 group/handle ' +
  'opacity-0 group-hover/card:opacity-60 hover:!opacity-100';

/** Inner vertical edge — width. `side` is which side of THIS chart the seam is on. */
function WidthHandle({
  side,
  active,
  onPointerDown,
  onDoubleClick,
}: {
  side: 'left' | 'right';
  active: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="button"
      aria-label="Resize width"
      title="Drag to resize width · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      // Inset top/bottom so it doesn't fight the corner grip.
      className={`${baseHandle} top-3 bottom-7 w-2.5 cursor-ew-resize flex items-center justify-center ${
        side === 'right' ? 'right-0' : 'left-0'
      } ${active ? '!opacity-100' : ''}`}
    >
      <span
        className="w-[3px] h-10 rounded-full transition-colors"
        style={{ background: active ? 'var(--accent)' : 'var(--text-tertiary)' }}
      />
    </div>
  );
}

/** Bottom edge — height. `inset` leaves room for the corner grip. */
function HeightHandle({
  inset,
  active,
  onPointerDown,
  onDoubleClick,
}: {
  inset: 'left' | 'right';
  active: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="button"
      aria-label="Resize height"
      title="Drag to resize height · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`${baseHandle} bottom-0 h-2.5 cursor-ns-resize flex items-center justify-center ${
        inset === 'right' ? 'left-3 right-7' : 'left-7 right-3'
      } ${active ? '!opacity-100' : ''}`}
    >
      <span
        className="h-[3px] w-10 rounded-full transition-colors"
        style={{ background: active ? 'var(--accent)' : 'var(--text-tertiary)' }}
      />
    </div>
  );
}

/** Inner-bottom corner — both axes. */
function CornerGrip({
  side,
  active,
  onPointerDown,
  onDoubleClick,
}: {
  side: 'left' | 'right';
  active: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  const cursor = side === 'right' ? 'cursor-nwse-resize' : 'cursor-nesw-resize';
  return (
    <div
      role="button"
      aria-label="Resize chart"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={
        `absolute bottom-1 z-30 w-5 h-5 ${cursor} flex items-end transition-opacity duration-200 ` +
        (side === 'right' ? 'right-1 justify-end' : 'left-1 justify-start ') +
        (active ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-60 hover:!opacity-100')
      }
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
        style={side === 'left' ? { transform: 'scaleX(-1)' } : undefined}
      >
        <path
          d="M13 5 L5 13 M13 9 L9 13 M13 1 L1 13"
          stroke={active ? 'var(--accent)' : 'var(--text-tertiary)'}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function ResizableChartRow({
  storageKey,
  children,
  defaultHeight = DEFAULT_H,
}: {
  storageKey: string;
  children: React.ReactNode;
  defaultHeight?: number;
}) {
  const kids = Children.toArray(children).filter(isValidElement);
  const containerRef = useRef<HTMLDivElement>(null);

  const [split, setSplit] = useState(50);
  const [rowH, setRowH] = useState(defaultHeight);
  const [drag, setDrag] = useState<{ idx: number; mode: DragMode } | null>(null);
  const [wrapPulse, setWrapPulse] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const prevWrapped = useRef(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Captured at pointer-down so dragging applies a DELTA from the start point
  // rather than snapping size to the absolute cursor position (no first-move jump).
  const dragStart = useRef<{ x: number; y: number; split: number; rowH: number } | null>(null);

  useEffect(() => {
    const p = loadPersisted(storageKey);
    if (p) {
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, p.split)));
      setRowH(Math.min(MAX_H, Math.max(MIN_H, p.rowH)));
    }
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [storageKey]);

  const wrapped = split > WRAP_AT;

  useEffect(() => {
    if (prevWrapped.current !== wrapped) {
      prevWrapped.current = wrapped;
      setWrapPulse(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setWrapPulse(false), 260);
    }
  }, [wrapped]);

  const persist = useCallback(
    (s: number, h: number) => savePersisted(storageKey, { split: s, rowH: h }),
    [storageKey],
  );

  const cursorFor = (idx: number, mode: DragMode) =>
    mode === 'x'
      ? 'ew-resize'
      : mode === 'y'
        ? 'ns-resize'
        : idx === 0
          ? 'nwse-resize'
          : 'nesw-resize';

  const startDrag = useCallback(
    (idx: number, mode: DragMode) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragStart.current = { x: e.clientX, y: e.clientY, split, rowH };
      setDrag({ idx, mode });
      document.body.style.userSelect = 'none';
      document.body.style.cursor = cursorFor(idx, mode);
    },
    [split, rowH],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag || !containerRef.current || !dragStart.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const start = dragStart.current;

      if (drag.mode === 'x' || drag.mode === 'both') {
        // Horizontal travel since drag-start → % of the row, added to the
        // start split. Dragging chart 0's seam right grows it (+); dragging
        // chart 1's seam right grows IT, shrinking the left split (−).
        const dxPct = ((e.clientX - start.x) / rect.width) * 100;
        const nextSplit = drag.idx === 0 ? start.split + dxPct : start.split - dxPct;
        setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, nextSplit)));
      }

      if (drag.mode === 'y' || drag.mode === 'both') {
        const nextH = start.rowH + (e.clientY - start.y);
        setRowH(Math.min(MAX_H, Math.max(MIN_H, nextH)));
      }
    },
    [drag],
  );

  const endDrag = useCallback(() => {
    if (!drag) return;
    setDrag(null);
    dragStart.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    persist(split, rowH);
  }, [drag, split, rowH, persist]);

  const resetBoth = useCallback(() => {
    setSplit(50);
    setRowH(defaultHeight);
    persist(50, defaultHeight);
  }, [persist, defaultHeight]);

  if (!isDesktop || kids.length < 2) {
    return (
      <div
        className="grid grid-cols-1 gap-4"
        style={{ ['--chart-h' as string]: `${defaultHeight}px` }}
      >
        {children}
      </div>
    );
  }

  const half = GAP_PX / 2;
  const animate = drag === null || wrapPulse;
  const basisTransition = animate ? 'flex-basis 240ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';

  const paneStyle = (idx: number): React.CSSProperties => ({
    flexBasis: wrapped ? '100%' : `calc(${idx === 0 ? split : 100 - split}% - ${half}px)`,
    flexGrow: 0,
    flexShrink: 0,
    transition: basisTransition,
  });

  return (
    <div
      ref={containerRef}
      className="relative flex flex-wrap items-stretch"
      style={{ gap: `${GAP_PX}px`, ['--chart-h' as string]: `${rowH}px` }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {[0, 1].map((idx) => {
        const seam = idx === 0 ? 'right' : 'left'; // inner edge of this chart
        const dragging = drag?.idx === idx;
        return (
          <div key={idx} className="group/card relative min-w-0" style={paneStyle(idx)}>
            {cloneElement(kids[idx] as React.ReactElement, { isDragging: dragging })}
            <WidthHandle
              side={seam}
              active={!!dragging && drag?.mode === 'x'}
              onPointerDown={startDrag(idx, 'x')}
              onDoubleClick={resetBoth}
            />
            <HeightHandle
              inset={seam}
              active={!!dragging && drag?.mode === 'y'}
              onPointerDown={startDrag(idx, 'y')}
              onDoubleClick={resetBoth}
            />
            <CornerGrip
              side={seam}
              active={!!dragging && drag?.mode === 'both'}
              onPointerDown={startDrag(idx, 'both')}
              onDoubleClick={resetBoth}
            />
          </div>
        );
      })}

      {kids.slice(2).map((k, i) => (
        <div key={`x${i}`} className="min-w-0" style={{ flexBasis: `calc(50% - ${half}px)` }}>
          {k}
        </div>
      ))}
    </div>
  );
}
