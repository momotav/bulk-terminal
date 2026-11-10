'use client';

// With two or more charts open (and no basket yet), a dashed gold line runs from
// chart to chart in right-angle steps, a soft glow under it and a light pulse
// travelling along it, with a "Build basket" pill on the middle run: the cue that
// these markets can be traded together. It sits under the windows, so it shows in
// the gaps, and follows them live while they're dragged: positions are read each
// frame and written straight to the SVG, never through React state.

import { useEffect, useRef } from 'react';
import { Layers } from 'lucide-react';
import { dock } from '@/lib/basket';

const GOLD = '#F3B65B';
const PULSE = 26;      // px, length of the travelling light
const SPEED = 0.22;    // px per ms

type Box = { l: number; t: number; r: number; b: number; cx: number; cy: number };

/** Right-angle route between two boxes, out of the sides that face each other. */
function route(a: Box, b: Box): { d: string; mid: [number, number]; ends: [number, number][] } {
  const gapX = Math.max(b.l - a.r, a.l - b.r);
  const gapY = Math.max(b.t - a.b, a.t - b.b);
  if (gapX >= gapY) {
    const right = b.l >= a.r;
    const x1 = right ? a.r : a.l; const x2 = right ? b.l : b.r;
    const y1 = clampTo(a, b, 'y', a.cy); const y2 = clampTo(b, a, 'y', b.cy);
    const mx = Math.round((x1 + x2) / 2);
    return { d: `M${x1},${y1} H${mx} V${y2} H${x2}`, mid: [mx, (y1 + y2) / 2], ends: [[x1, y1], [x2, y2]] };
  }
  const down = b.t >= a.b;
  const y1 = down ? a.b : a.t; const y2 = down ? b.t : b.b;
  const x1 = clampTo(a, b, 'x', a.cx); const x2 = clampTo(b, a, 'x', b.cx);
  const my = Math.round((y1 + y2) / 2);
  return { d: `M${x1},${y1} V${my} H${x2} V${y2}`, mid: [(x1 + x2) / 2, my], ends: [[x1, y1], [x2, y2]] };
}

/** Where the boxes face each other, start inside the shared span: a straight run when they line up. */
function clampTo(self: Box, other: Box, axis: 'x' | 'y', fallback: number) {
  const lo = Math.max(axis === 'x' ? self.l : self.t, axis === 'x' ? other.l : other.t) + 24;
  const hi = Math.min(axis === 'x' ? self.r : self.b, axis === 'x' ? other.r : other.b) - 24;
  return lo <= hi ? Math.round((lo + hi) / 2) : Math.round(fallback);
}

export function BasketLink({ ids, below, above }: { ids: string[]; below: number; above: number }) {
  const svg = useRef<SVGSVGElement | null>(null);
  const pill = useRef<HTMLButtonElement | null>(null);
  const key = ids.join(',');

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const boxes: Box[] = [];
      for (const id of ids) {
        const r = document.querySelector<HTMLElement>(`[data-win-id="${id}"]`)?.getBoundingClientRect();
        if (r && r.width > 0) boxes.push({ l: r.left, t: r.top, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
      }
      const s = svg.current;
      if (s) {
        const groups = s.querySelectorAll<SVGGElement>('g[data-seg]');
        const overlap = boxes.length >= 2 && boxes.slice(1).every((b, i) => { const a = boxes[i]; return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b; });
        let mid: [number, number] | null = null;
        groups.forEach((g, i) => {
          const a = boxes[i]; const b = boxes[i + 1];
          const show = !!a && !!b && !overlap;
          g.style.opacity = show ? '1' : '0';
          if (!show) return;
          const r = route(a, b);
          const paths = g.querySelectorAll('path');
          paths.forEach((p) => p.setAttribute('d', r.d));
          // The pulse: one short bright dash riding the line, start to end, on a loop.
          const pulse = paths[paths.length - 1] as SVGPathElement;
          const len = pulse.getTotalLength();
          if (len > 0) {
            pulse.setAttribute('stroke-dasharray', `${PULSE} ${len + PULSE}`);
            pulse.setAttribute('stroke-dashoffset', String(PULSE - (((now - t0) * SPEED + i * 140) % (len + PULSE))));
          }
          const ends = g.querySelectorAll('rect');
          r.ends.forEach(([x, y], k) => { ends[k]?.setAttribute('x', String(x - 3)); ends[k]?.setAttribute('y', String(y - 3)); });
          if (i === Math.floor((boxes.length - 2) / 2)) mid = r.mid;
        });
        if (overlap) {
          // Windows on top of each other: no gap for the line, so the pill rides above them.
          const l = Math.min(...boxes.map((x) => x.l)); const rr = Math.max(...boxes.map((x) => x.r));
          mid = [(l + rr) / 2, Math.max(80, Math.min(...boxes.map((x) => x.t)) - 22)];
        }
        if (pill.current) {
          if (mid) { pill.current.style.left = `${mid[0]}px`; pill.current.style.top = `${mid[1]}px`; pill.current.style.visibility = 'visible'; }
          else pill.current.style.visibility = 'hidden';
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const segs = Math.max(0, ids.length - 1);
  return (
    <>
      <svg ref={svg} aria-hidden className="fixed inset-0 w-screen h-screen pointer-events-none basket-link-in" style={{ zIndex: below }}>
        {Array.from({ length: segs }, (_, i) => (
          <g key={i} data-seg="">
            <path fill="none" stroke={GOLD} strokeOpacity={0.14} strokeWidth={8} strokeLinejoin="miter" />
            <path fill="none" stroke={GOLD} strokeOpacity={0.9} strokeWidth={1.5} strokeDasharray="7 6" strokeLinejoin="miter" className="basket-link-flow" />
            <path fill="none" stroke={GOLD} strokeOpacity={0.35} strokeWidth={6} strokeLinecap="round" />
            <path fill="none" stroke="#FFE3AE" strokeWidth={2.25} strokeLinecap="round" />
            <rect width={6} height={6} fill={GOLD} className="basket-link-dot" />
            <rect width={6} height={6} fill={GOLD} className="basket-link-dot" />
          </g>
        ))}
      </svg>
      <button ref={pill} type="button" onClick={() => dock.openBasket()}
        className="fixed -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full text-[12px] font-medium text-[#1a1408] shadow-lg hover:brightness-105 basket-link-pill"
        style={{ zIndex: above, background: GOLD, visibility: 'hidden' }}>
        <Layers className="w-3.5 h-3.5" /> Build basket
      </button>
    </>
  );
}
