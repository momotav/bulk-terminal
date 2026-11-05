'use client';

import { useEffect, useRef } from 'react';

const HOSTS = '.recharts-wrapper, .tv-lightweight-charts';
const TIP_GAP = 14;
const REFRESH_MS = 1000;

type Box = { left: number; top: number; width: number; height: number };

/** The plot area inside a chart, in the chart's own pixels. */
function plotOf(host: HTMLElement): Box | null {
  if (host.classList.contains('recharts-wrapper')) {
    // Charts with nothing to read on hover (bare sparklines) get no line.
    if (!host.querySelector('.recharts-tooltip-wrapper')) return null;
    const clip = host.querySelector('clipPath[id$="-clip"] rect');
    if (!clip) return null;
    const n = (name: string) => Number(clip.getAttribute(name)) || 0;
    return { left: n('x'), top: n('y'), width: n('width'), height: n('height') };
  }
  // lightweight-charts lays out a table; the widest cell of the top row is the pane.
  const cells = Array.from(host.querySelectorAll<HTMLElement>('tr:first-child > td'));
  const pane = cells.sort((a, b) => b.clientWidth - a.clientWidth)[0];
  if (!pane) return null;
  const outer = host.getBoundingClientRect();
  const r = pane.getBoundingClientRect();
  return { left: r.left - outer.left, top: r.top - outer.top, width: r.width, height: r.height };
}

/**
 * The hover line on every chart follows the mouse instead of jumping from point to
 * point, and recharts tooltips ride along with it. The libraries still pick what the
 * tooltip reads, so values stay those of the nearest data point.
 *
 * Mounted once for the whole site. Listening on the document means no chart has to
 * opt in and new charts get it for free.
 *
 * A mouse move has to stay nearly free. Chrome holds move events until the next
 * frame is drawn, so a slow frame stalls hover altogether while a click still gets
 * through. So a move only writes one transform on one line and two values on the
 * tooltip. Writing to the chart element instead restyles everything inside it, and
 * chart geometry is read once on entry, not per move.
 */
export function FreeChartCursor() {
  const lineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;

    let host: HTMLElement | null = null;
    let tip: HTMLElement | null = null;
    let box: DOMRect | null = null;
    let plot: Box | null = null;
    let lineTop = 0;
    let boundAt = 0;
    let tipW = 0;
    let tipH = 0;
    let frame = 0;
    let pending: { x: number; y: number; target: EventTarget | null } | null = null;

    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };

    // A tooltip is empty until recharts fills it, so its size arrives late.
    const tipSize = new ResizeObserver(([entry]) => {
      tipW = entry.borderBoxSize[0].inlineSize;
      tipH = entry.borderBoxSize[0].blockSize;
      schedule();
    });

    const release = () => {
      tipSize.disconnect();
      tip?.removeAttribute('data-free-tip');
      line.style.display = 'none';
      host = tip = null;
      box = plot = null;
    };

    const bind = (next: HTMLElement) => {
      release();
      const nextPlot = plotOf(next);
      if (!nextPlot) return;
      host = next;
      box = next.getBoundingClientRect();
      plot = nextPlot;
      boundAt = performance.now();
      // A page chart scrolls under the sticky header; a chart in a popup sits above it.
      const header = next.closest('.fixed') ? null : document.querySelector('header');
      const top = box.top + plot.top;
      lineTop = Math.max(top, header?.getBoundingClientRect().bottom ?? top);
      line.style.height = `${Math.max(0, top + plot.height - lineTop)}px`;
      tip = next.querySelector<HTMLElement>('.recharts-tooltip-wrapper');
      tipW = tipH = 0;
      if (tip) tipSize.observe(tip);
    };

    const paint = () => {
      frame = 0;
      if (!pending) return;
      const { x, y, target } = pending;
      const next = target instanceof Element ? target.closest<HTMLElement>(HOSTS) : null;
      if (!next) { release(); return; }
      // Rebinding now and then picks up axes that resized with new data.
      if (next !== host || performance.now() - boundAt > REFRESH_MS) bind(next);
      if (!host || !box || !plot) return;

      const mx = x - box.left;
      const my = y - box.top;
      if (mx < plot.left || mx > plot.left + plot.width || my < plot.top || my > plot.top + plot.height) {
        line.style.display = 'none';
        tip?.removeAttribute('data-free-tip');
        return;
      }

      line.style.display = 'block';
      line.style.transform = `translate3d(${x}px, ${lineTop}px, 0)`;

      if (tip) {
        // Beside the mouse, flipping sides and clamping so it stays inside the chart.
        const right = mx + TIP_GAP;
        const tx = right + tipW <= box.width ? right : Math.max(0, mx - TIP_GAP - tipW);
        const ty = Math.max(0, Math.min(my + TIP_GAP, box.height - tipH));
        tip.style.setProperty('--tip-x', `${tx}px`);
        tip.style.setProperty('--tip-y', `${ty}px`);
        tip.setAttribute('data-free-tip', '');
      }
    };

    const onMove = (e: PointerEvent) => {
      pending = { x: e.clientX, y: e.clientY, target: e.target };
      schedule();
    };
    // Positions are cached, so anything that moves the page starts them over.
    const onShift = () => release();

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', release);
    window.addEventListener('scroll', onShift, { passive: true, capture: true });
    window.addEventListener('resize', onShift, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onMove);
      document.documentElement.removeEventListener('pointerleave', release);
      window.removeEventListener('scroll', onShift, { capture: true });
      window.removeEventListener('resize', onShift);
      if (frame) cancelAnimationFrame(frame);
      release();
    };
  }, []);

  return <div ref={lineRef} aria-hidden className="free-cursor-line" />;
}
