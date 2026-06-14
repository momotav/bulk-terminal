'use client';

// ----------------------------------------------------------------------------
// ResizableChartRow
//
// A two-chart row where each chart carries its own bottom-right corner
// grip (revealed on hover). Dragging a chart's grip resizes that chart in
// BOTH axes at once:
//   - width: the dragged chart's share of the row (neighbor takes the
//     remainder — widths always sum to 100%, so growing one shrinks the
//     other proportionally)
//   - height: the row's chart-body height (both charts share one height)
//
// Past 75% width the neighbor wraps to its own full-width row with a
// smooth eased reflow; dragging back below 75% un-wraps it.
//
// Replaces the earlier divider-seam model. The corner grip is the more
// familiar "resize this panel" affordance and lets the user grab the
// chart itself rather than hunting for the seam between two charts.
//
// Smoothness design:
//  - During an active drag NO CSS transitions run — width and height
//    update in the same frame, 1:1 with the cursor.
//  - Transitions fire only for discrete jumps: the wrap/unwrap reflow at
//    75% and double-click resets, eased over 240ms.
//  - The dragged chart gets a subtle blur (ChartCard isDragging prop).
//
// Only active on lg+ viewports; below that charts stack full-width and
// grips are hidden.
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

function CornerGrip({
  active,
  onPointerDown,
  onDoubleClick,
}: {
  active: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="button"
      aria-label="Resize chart"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={
        'absolute bottom-1 right-1 z-20 w-5 h-5 cursor-nwse-resize ' +
        'flex items-end justify-end transition-opacity duration-200 ' +
        (active ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-60 hover:!opacity-100')
      }
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
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
}: {
  storageKey: string;
  children: React.ReactNode;
}) {
  const kids = Children.toArray(children).filter(isValidElement);
  const containerRef = useRef<HTMLDivElement>(null);

  const [split, setSplit] = useState(50);
  const [rowH, setRowH] = useState(DEFAULT_H);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [wrapPulse, setWrapPulse] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const prevWrapped = useRef(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const startDrag = useCallback(
    (idx: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragIdx(idx);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'nwse-resize';
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragIdx === null || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      // Width: cursor-x maps to the left chart's width. Dragging the left
      // chart's grip sets its width directly; dragging the right chart's
      // grip grows it as the cursor nears the row's right edge (so the
      // left split shrinks). Either way "drag toward the outside = this
      // chart grows".
      const cursorPct = ((e.clientX - rect.left) / rect.width) * 100;
      const nextSplit = dragIdx === 0 ? cursorPct : 100 - cursorPct;
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, nextSplit)));

      // Height: cursor-y minus card chrome.
      const h = e.clientY - rect.top - 110;
      setRowH(Math.min(MAX_H, Math.max(MIN_H, h)));
    },
    [dragIdx],
  );

  const endDrag = useCallback(() => {
    if (dragIdx === null) return;
    setDragIdx(null);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    persist(split, rowH);
  }, [dragIdx, split, rowH, persist]);

  const resetBoth = useCallback(() => {
    setSplit(50);
    setRowH(DEFAULT_H);
    persist(50, DEFAULT_H);
  }, [persist]);

  if (!isDesktop || kids.length < 2) {
    return (
      <div
        className="grid grid-cols-1 gap-4"
        style={{ ['--chart-h' as string]: `${DEFAULT_H}px` }}
      >
        {children}
      </div>
    );
  }

  const half = GAP_PX / 2;
  const animate = dragIdx === null || wrapPulse;
  const basisTransition = animate
    ? 'flex-basis 240ms cubic-bezier(0.22, 1, 0.36, 1)'
    : 'none';

  const paneStyle = (idx: number): React.CSSProperties => ({
    flexBasis: wrapped
      ? '100%'
      : `calc(${idx === 0 ? split : 100 - split}% - ${half}px)`,
    flexGrow: 0,
    flexShrink: 0,
    transition: basisTransition,
  });

  return (
    <div
      ref={containerRef}
      className="relative flex flex-wrap items-stretch"
      style={{
        gap: `${GAP_PX}px`,
        ['--chart-h' as string]: `${rowH}px`,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {[0, 1].map((idx) => (
        <div key={idx} className="group/card relative min-w-0" style={paneStyle(idx)}>
          {cloneElement(kids[idx] as React.ReactElement, { isDragging: dragIdx === idx })}
          <CornerGrip
            active={dragIdx === idx}
            onPointerDown={startDrag(idx)}
            onDoubleClick={resetBoth}
          />
        </div>
      ))}

      {kids.slice(2).map((k, i) => (
        <div key={`x${i}`} className="min-w-0" style={{ flexBasis: `calc(50% - ${half}px)` }}>
          {k}
        </div>
      ))}
    </div>
  );
}
