'use client';

// ----------------------------------------------------------------------------
// ResizableChartRow
//
// A two-chart row where the user can drag the boundary between charts to
// resize them, and drag the bottom edge to change the row's height.
//
// Behavior spec (per Nadiia):
//  - Dragging the divider grows one chart while the neighbor shrinks
//    proportionally (widths always sum to 100% of the row).
//  - Past 75% width, the neighbor wraps onto a new row (full width) with
//    a smooth animated reflow. Dragging back below 75% un-wraps it.
//  - Bottom-edge drag adjusts the height of both charts in the row.
//  - Double-click the divider → reset to 50/50. Double-click the bottom
//    handle → reset height.
//  - Layout persists per-row in localStorage.
//
// Smoothness design:
//  - During an active drag, NO CSS transitions run — both charts update
//    in the same frame, 1:1 with the cursor. Transitions during drag
//    cause the neighbor to lag behind, the basis sum to exceed 100%,
//    and the flex row to flicker-wrap. Synchronized instant updates are
//    what "smooth" actually feels like here.
//  - Transitions ARE enabled for discrete jumps: the wrap/unwrap reflow
//    at the 75% threshold and the double-click resets. These animate
//    flex-basis over 240ms with an ease-out curve.
//  - Charts re-render through Recharts' ResponsiveContainer resize
//    observer. The card content gets a subtle blur while dragging (via
//    the ChartCard isDragging prop pattern) which masks intermediate
//    paint states.
//
// Only active on lg+ viewports (matching the old `lg:grid-cols-2`);
// below that, charts stack full-width and handles are hidden.
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

const MIN_SPLIT = 25; // % — a chart can't be squeezed below a quarter row
const MAX_SPLIT = 100; // % — dragged chart may take the full row
const WRAP_AT = 75; // % — past this, the neighbor wraps to a new row
const MIN_H = 180; // px chart-body height
const MAX_H = 640;
const DEFAULT_H = 260; // matches the page's original h-[260px] chart bodies
const GAP_PX = 16; // matches gap-4

type Persisted = { split: number; rowH: number };

function loadPersisted(key: string): Persisted | null {
  try {
    const raw = localStorage.getItem(`chart-row:${key}`);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.split === 'number' && typeof p?.rowH === 'number') return p;
  } catch {
    /* corrupted or unavailable storage — fall back to defaults */
  }
  return null;
}

function savePersisted(key: string, p: Persisted): void {
  try {
    localStorage.setItem(`chart-row:${key}`, JSON.stringify(p));
  } catch {
    /* storage full/blocked — resizing still works for the session */
  }
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
  const [dragging, setDragging] = useState<'x' | 'y' | null>(null);
  // Pulses true for one animation beat when the wrap state flips during a
  // drag, so the neighbor's jump to/from 100% is eased even though normal
  // drag updates are transition-free.
  const [wrapPulse, setWrapPulse] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const prevWrapped = useRef(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate persisted layout + watch the lg breakpoint.
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

  // Detect wrap-state flips mid-drag and pulse a transition for the reflow.
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

  const startDragX = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging('x');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [],
  );

  const startDragY = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging('y');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (dragging === 'x') {
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct)));
      } else {
        // rowH is the chart-body height; subtract a rough card-chrome
        // offset so the cursor tracks the bottom edge naturally.
        const h = e.clientY - rect.top - 110;
        setRowH(Math.min(MAX_H, Math.max(MIN_H, h)));
      }
    },
    [dragging],
  );

  const endDrag = useCallback(() => {
    if (!dragging) return;
    setDragging(null);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    persist(split, rowH);
  }, [dragging, split, rowH, persist]);

  const resetSplit = useCallback(() => {
    setSplit(50);
    persist(50, rowH);
  }, [rowH, persist]);

  const resetHeight = useCallback(() => {
    setRowH(DEFAULT_H);
    persist(split, DEFAULT_H);
  }, [split, persist]);

  // Mobile / tablet: plain stacked layout, no handles, default height.
  if (!isDesktop || kids.length < 2) {
    return (
      <div className="grid grid-cols-1 gap-4" style={{ ['--chart-h' as string]: `${DEFAULT_H}px` }}>
        {children}
      </div>
    );
  }

  const half = GAP_PX / 2;
  // flex-basis transitions: off while dragging (synchronized 1:1 cursor
  // tracking), on for wrap reflow + resets. wrapPulse forces the eased
  // reflow even mid-drag when the 75% threshold is crossed.
  const animate = !dragging || wrapPulse;
  const basisTransition = animate
    ? 'flex-basis 240ms cubic-bezier(0.22, 1, 0.36, 1), height 240ms cubic-bezier(0.22, 1, 0.36, 1)'
    : 'none';

  return (
    <div
      ref={containerRef}
      className="relative flex flex-wrap"
      style={{
        gap: `${GAP_PX}px`,
        // Chart bodies inside ChartCard read this var for their height.
        ['--chart-h' as string]: `${rowH}px`,
        // Reserve a little room for the bottom handle's hit area.
        paddingBottom: '6px',
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Chart A — the directly resizable one. */}
      <div
        className="relative min-w-0"
        style={{
          flexBasis: wrapped ? '100%' : `calc(${split}% - ${half}px)`,
          flexGrow: 0,
          flexShrink: 0,
          transition: basisTransition,
        }}
      >
        {cloneElement(kids[0] as React.ReactElement, { isDragging: dragging !== null })}

        {/* Vertical divider handle on A's right edge. Still functional when
            wrapped — dragging left past 75% un-wraps the neighbor. */}
        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize · double-click to reset"
          className="group absolute top-0 bottom-0 -right-[10px] w-5 z-10 cursor-col-resize flex items-center justify-center"
          onPointerDown={startDragX}
          onDoubleClick={resetSplit}
        >
          <div
            className={
              'w-1 rounded-full transition-all duration-200 ' +
              (dragging === 'x'
                ? 'h-16 bg-[var(--accent)]'
                : 'h-10 bg-[var(--border-color)] group-hover:h-16 group-hover:bg-[var(--accent)]/70')
            }
          />
        </div>
      </div>

      {/* Chart B — the neighbor. Takes the remainder, or wraps to its own
          full-width row past the threshold. */}
      <div
        className="min-w-0"
        style={{
          flexBasis: wrapped ? '100%' : `calc(${100 - split}% - ${half}px)`,
          flexGrow: 0,
          flexShrink: 0,
          transition: basisTransition,
        }}
      >
        {cloneElement(kids[1] as React.ReactElement, { isDragging: dragging !== null })}
      </div>

      {/* Any further children (3-chart rows) flow naturally as full rows
          below — they don't participate in the resize pair. */}
      {kids.slice(2).map((k, i) => (
        <div key={i} className="min-w-0" style={{ flexBasis: `calc(50% - ${half}px)` }}>
          {k}
        </div>
      ))}

      {/* Horizontal handle along the bottom — adjusts row height. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize height · double-click to reset"
        className="group absolute left-0 right-0 -bottom-[8px] h-4 z-10 cursor-row-resize flex items-center justify-center"
        onPointerDown={startDragY}
        onDoubleClick={resetHeight}
      >
        <div
          className={
            'h-1 rounded-full transition-all duration-200 ' +
            (dragging === 'y'
              ? 'w-24 bg-[var(--accent)]'
              : 'w-14 bg-[var(--border-color)] group-hover:w-24 group-hover:bg-[var(--accent)]/70')
          }
        />
      </div>
    </div>
  );
}
